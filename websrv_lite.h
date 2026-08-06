#ifndef WEBSRV_LITE_H
#define WEBSRV_LITE_H

#include <stddef.h>
#include <stdint.h>

/* Register a static asset. Called from generated webui.c constructors. */
void asset_register(const char* path, const void* data, unsigned long size,
                    const char* mime);

/* Serve registered assets forever. Returns only on fatal error. */
int webserver_run(uint16_t port);

#endif