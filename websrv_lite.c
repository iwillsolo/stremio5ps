/* websrv_lite.c - minimal single-file HTTP server for registered assets.
 * Modeled on BFpilot's websrv_lite (MIT), written for stremio5ps.
 * Serves docs/ from the PS5 itself; binds 0.0.0.0 so you can also debug
 * from a PC browser at http://<ps5-ip>:9023 while the payload runs. */
#include <arpa/inet.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include "websrv_lite.h"

#define ASSET_MAX   64
#define REQ_MAX     4096
#define SEND_CHUNK  16384

struct asset {
  char         path[128];
  const void*  data;
  unsigned long size;
  char         mime[64];
};

static struct asset assets[ASSET_MAX];
static unsigned int asset_count;

void
asset_register(const char* path, const void* data, unsigned long size,
               const char* mime) {
  if (asset_count >= ASSET_MAX) {
    printf("websrv: too many assets (>%d)\n", ASSET_MAX);
    return;
  }
  struct asset* a = &assets[asset_count++];
  snprintf(a->path, sizeof(a->path), "%s", path);
  a->data = data;
  a->size = size;
  snprintf(a->mime, sizeof(a->mime), "%s", mime ? mime : "application/octet-stream");
  printf("websrv: registered /%s (%lu bytes, %s)\n",
         a->path + (a->path[0] == '/' ? 1 : 0), a->size, a->mime);
}

static const struct asset*
find_asset(const char* path) {
  char p[128];
  snprintf(p, sizeof(p), "%s", path);
  /* strip query string */
  char* q = strchr(p, '?');
  if (q) *q = 0;
  /* map "/" and "" to the app entry point */
  if (!p[0] || (p[0] == '/' && !p[1]) || strcmp(p, "/index.html") == 0)
    return find_asset("/index.html");
  for (unsigned int i = 0; i < asset_count; i++)
    if (strcmp(assets[i].path, p) == 0)
      return &assets[i];
  return 0;
}

static int
send_all(int fd, const void* buf, size_t len) {
  const char* p = buf;
  while (len) {
    ssize_t n = send(fd, p, len > SEND_CHUNK ? SEND_CHUNK : len, 0);
    if (n <= 0) return -1;
    p += n;
    len -= (size_t)n;
  }
  return 0;
}

static int
send_head(int fd, const char* status, const char* mime, unsigned long len) {
  char head[512];
  int n = snprintf(head, sizeof(head),
    "HTTP/1.1 %s\r\n"
    "Content-Type: %s\r\n"
    "Content-Length: %lu\r\n"
    "Connection: close\r\n"
    "Cache-Control: no-store\r\n"
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
    "Access-Control-Allow-Private-Network: true\r\n"
    "\r\n",
    status, mime, len);
  return send_all(fd, head, (size_t)n);
}

static void
serve_conn(int fd) {
  char buf[REQ_MAX + 1];
  size_t got = 0;
  /* read until end of headers */
  while (got < REQ_MAX) {
    ssize_t n = recv(fd, buf + got, REQ_MAX - got, 0);
    if (n <= 0) { close(fd); return; }
    got += (size_t)n;
    buf[got] = 0;
    if (strstr(buf, "\r\n\r\n")) break;
  }
  buf[got] = 0;

  /* parse request line: METHOD SP PATH SP HTTP/x.y */
  char method[16], path[256];
  if (sscanf(buf, "%15s %255s", method, path) != 2) {
    send_head(fd, "400 Bad Request", "text/plain", 11);
    send_all(fd, "bad request", 11);
    close(fd);
    return;
  }

  if (strcmp(method, "OPTIONS") == 0) {
    send_head(fd, "204 No Content", "text/plain", 0);
    close(fd);
    return;
  }
  if (strcmp(method, "GET") != 0 && strcmp(method, "HEAD") != 0) {
    send_head(fd, "405 Method Not Allowed", "text/plain", 13);
    send_all(fd, "not allowed", 13);
    close(fd);
    return;
  }

  const struct asset* a = find_asset(path);
  if (!a) {
    send_head(fd, "404 Not Found", "text/plain", 9);
    send_all(fd, "not found", 9);
    close(fd);
    return;
  }

  send_head(fd, "200 OK", a->mime, a->size);
  if (strcmp(method, "GET") == 0)
    send_all(fd, a->data, a->size);
  close(fd);
}

static void*
conn_thread(void* arg) {
  int fd = (int)(intptr_t)arg;
  serve_conn(fd);
  return 0;
}

int
webserver_run(uint16_t port) {
  int srv = socket(AF_INET, SOCK_STREAM, 0);
  if (srv < 0) { perror("socket"); return -1; }

  int one = 1;
  setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  addr.sin_port = htons(port);

  if (bind(srv, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
    perror("bind");
    close(srv);
    return -1;
  }
  if (listen(srv, 8) < 0) {
    perror("listen");
    close(srv);
    return -1;
  }

  printf("websrv: listening on http://0.0.0.0:%u/ (UI on http://127.0.0.1:%u/)\n",
         (unsigned)port, (unsigned)port);

  for (;;) {
    int fd = accept(srv, 0, 0);
    if (fd < 0) { perror("accept"); return -1; }
    pthread_t th;
    if (pthread_create(&th, 0, conn_thread, (void*)(intptr_t)fd) != 0) {
      serve_conn(fd);   /* fallback: handle inline */
    } else {
      pthread_detach(th);
    }
  }
}