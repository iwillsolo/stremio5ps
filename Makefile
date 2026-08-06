# Copyright (C) 2026 - GPLv3+, modeled on ps5-payload-dev/svtplay
PS5_HOST ?= ps5
PS5_PORT ?= 9021

ifdef PS5_PAYLOAD_SDK
include $(PS5_PAYLOAD_SDK)/toolchain/prospero.mk
else
$(error PS5_PAYLOAD_SDK is undefined)
endif

ELF := stremio-install.elf

CFLAGS := -Wall -Werror -g -DTITLE_ID="\"BREW10003\""
LDADD := -lSceIpmi -lSceAppInstUtil

all: $(ELF)

$(ELF): install.c
	$(CC) $(CFLAGS) $(LDADD) -o $@ $^

install.c: sce_sys/param.json sce_sys/icon0.png

clean:
	rm -f $(ELF)

test: $(ELF)
	$(PS5_DEPLOY) -h $(PS5_HOST) -p $(PS5_PORT) $^s