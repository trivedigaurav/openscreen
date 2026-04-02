#!/bin/bash
# Test script for OpenScreen CLI mode
# Run this from a regular Terminal (not sandboxed) to test.

APP="/Applications/Openscreen.app/Contents/MacOS/Openscreen"

echo "=== Test 1: List Sources ==="
echo "Run: OPENSCREEN_LIST_SOURCES=1 $APP"
OPENSCREEN_LIST_SOURCES=1 "$APP" &
PID=$!
sleep 8
kill $PID 2>/dev/null
echo ""

echo "=== Test 2: Record 10 seconds (entire screen) ==="
echo "Run: OPENSCREEN_RECORD=1 OPENSCREEN_DURATION=10 $APP"
echo "Press Ctrl+C to skip this test"
OPENSCREEN_RECORD=1 OPENSCREEN_DURATION=10 "$APP" &
PID=$!
sleep 20
kill $PID 2>/dev/null
echo ""

echo "=== Test 3: Record Chrome window for 10 seconds ==="
echo "Run: OPENSCREEN_RECORD=1 OPENSCREEN_SOURCE=Chrome OPENSCREEN_DURATION=10 $APP"
echo "Press Ctrl+C to skip this test"
OPENSCREEN_RECORD=1 OPENSCREEN_SOURCE="Chrome" OPENSCREEN_DURATION=10 "$APP" &
PID=$!
sleep 20
kill $PID 2>/dev/null
echo ""

echo "Done! Check ~/Library/Application Support/Openscreen/recordings/ for output."
