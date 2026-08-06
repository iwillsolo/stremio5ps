# Copyright (C) 2026 - GPLv3+, modeled on ps5-payload-dev/svtplay
PS5_HOST ?= ps5
PS5_PORT ?= 9021

ifdef PS5_PAYLOAD_SDK
include $(PS5_PAYLOAD_SDK)/toolchain/prospero.mk
else
$(error PS5_PAYLOAD_SDK is undefined)
endif

ELF := stremio-install.elf
WEB_PORT ?= 9023

CFLAGS := -Wall -Werror -g -DTITLE_ID="\"BREW10003\"" -DWEB_PORT=$(WEB_PORT)
LDADD := -lSceIpmi -lSceAppInstUtil -lpthread

ASSETS := docs/index.html docs/css/app.css docs/js/stremio.js docs/js/input.js docs/js/app.js
GEN    := tools/gen-asset-module.py

all: $(ELF)

# One webui_<asset>.c per asset -> separate translation units -> no symbol clashes
.PHONY: webui
webui: $(ASSETS) $(GEN)
	@rm -f webui_*.c webui.c
	@for f in $(ASSETS); do \
	  rel=$${f#docs/}; \
	  safe=$$(printf '%s' "$$rel" | tr '/' '_'); \
	  echo "  embedding $$f -> /$$rel"; \
	  python3 $(GEN) -p "/$$rel" "$$f" > "webui_$$safe.c" || exit 1; \
	done

$(ELF): install.c websrv_lite.c websrv_lite.h webui
	$(CC) $(CFLAGS) $(LDADD) -o $@ install.c websrv_lite.c $(wildcard webui_*.c)

install.c: sce_sys/param.json sce_sys/icon0.png

clean:
	rm -f $(ELF) webui_*.c webui.c

test: $(ELF)
	$(PS5_DEPLOY) -h $(PS5_HOST) -p $(PS5_PORT) $^