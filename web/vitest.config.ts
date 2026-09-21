// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'

// Pure-function tests only, but they reach @mochi/web, whose barrel touches
// the document at import time and whose modules use @lingui/*/macro - so a DOM
// environment and the build's macro transform are both needed here.
export default defineConfig({
  plugins: [react({ plugins: [['@lingui/swc-plugin', {}]] })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
