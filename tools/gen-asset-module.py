#!/usr/bin/env python3
# Copyright (C) 2024 John Törnblom, GPLv3+ — adapted from BFpilot.
# Emits ONE self-contained C module per asset (separate TU, no header include).
import argparse
import string
import mimetypes

tmpl = string.Template('''
void asset_register(const char*, const void*, unsigned long, const char*);

static const unsigned char data[] = $data;

__attribute__((constructor)) static void
constructor(void) {
  asset_register("/$path", data, sizeof(data), "$mime");
}
''')


def gen_data(filename):
    yield '{\n  '
    with open(filename, mode='rb') as f:
        for n, b in enumerate(f.read(), 1):
            yield hex(b)
            yield ', '
            if n % 16 == 0:
                yield '\n  '
    yield '\n}'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('-p', '--path', default=None)
    parser.add_argument('FILE')
    args = parser.parse_args()

    if args.path is None:
        args.path = args.FILE

    data = ''.join(gen_data(args.FILE))
    print(tmpl.substitute(data=data, path=args.path,
                          mime=mimetypes.guess_type(args.path)[0]))