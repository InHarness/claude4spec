#!/bin/sh
git add -A -- . 2>/dev/null; git add -f .c4s-impl ':!.c4s-impl/packets' && git commit -qm "$1" && git log --oneline -1
