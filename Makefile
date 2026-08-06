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
# -lpthread: remove if your SDK already provides pthread inside libc
LDADD := -lSceIpmi -lSceAppInstUtil -lpthread

ASSET_FILES := docs/index.html $(wildcard docs/css/*.css) \
	       docs/js/stremio.js docs/js/input.js docs/js/app.js

all: $(ELF)

$(ELF): install.c websrv_lite.c websrv_lite.h webui.c
	$(CC) $(CFLAGS) $(LDADD) -o $@ install.c websrv_lite.c webui.c

# Generated C module: one constructor per web asset, paths mirror docs/
webui.c: $(ASSET_FILES) tools/gen-asset-module.py
	@printf '#include "websrv_lite.h"\n' > $@
	@for f in $(ASSET_FILES); do \
	  rel=$${f#docs/}; \
	  echo "  embedding $$f -> /$$rel"; \
	  python3 tools/gen-asset-module.py -p "/$$rel" "$$f" >> $@ || exit 1; \
	done

install.c: sce_sys/param.json sce_sys/icon0.png

clean:
	rm -f $(ELF) webui.c

test: $(ELF)
	$(PS5_DEPLOY) -h $(PS5_HOST) -p $(PS5_PORT) $^