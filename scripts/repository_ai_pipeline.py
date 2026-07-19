#!/usr/bin/env python3
"""Compatibility launcher. Prefer: python3 -m repository_analysis."""

from repository_analysis.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
