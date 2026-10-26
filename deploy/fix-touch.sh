#!/bin/sh
set -eu

# Raspberry Pi OS / labwc can translate touchscreen motion into mouse events.
# That makes taps work but prevents Chromium from receiving real touch-pan gestures.
# Keep a user-local copy of the labwc config and turn mouse emulation off for every
# touchscreen entry. This is safe to run repeatedly.
CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/labwc"
CFG="$CFG_DIR/rc.xml"
mkdir -p "$CFG_DIR"

if [ ! -f "$CFG" ]; then
  if [ -f /etc/xdg/labwc/rc.xml ]; then
    cp /etc/xdg/labwc/rc.xml "$CFG"
  elif [ -f /usr/share/labwc/rc.xml ]; then
    cp /usr/share/labwc/rc.xml "$CFG"
  else
    cat > "$CFG" <<'XML'
<?xml version="1.0"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <touch mouseEmulation="no" />
</openbox_config>
XML
  fi
fi

python3 - "$CFG" <<'PY'
from pathlib import Path
import re, sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8', errors='replace')
original = text

# Attribute-style Raspberry Pi entries:
#   <touch deviceName="..." mapToOutput="DSI-1" mouseEmulation="yes" />
def patch_open(m: re.Match[str]) -> str:
    tag = m.group(0)
    if re.search(r'\bmouseEmulation\s*=\s*["\']', tag, flags=re.I):
        return re.sub(r'(\bmouseEmulation\s*=\s*["\'])[^"\']*(["\'])', r'\1no\2', tag, flags=re.I)
    return tag[:-1].rstrip() + ' mouseEmulation="no"' + (' />' if tag.rstrip().endswith('/>') else '>')

text = re.sub(r'<touch\b[^>]*>', patch_open, text, flags=re.I)

# Element-style upstream labwc entries:
#   <touch> ... <mouseEmulation>yes</mouseEmulation> ... </touch>
def patch_block(m: re.Match[str]) -> str:
    block = m.group(0)
    return re.sub(r'(<mouseEmulation\s*>)[^<]*(</mouseEmulation\s*>)', r'\1no\2', block, flags=re.I)

text = re.sub(r'<touch\b[^>]*>.*?</touch\s*>', patch_block, text, flags=re.I | re.S)

# If the config has no touch entry at all, add a fallback before the root close.
if not re.search(r'<touch\b', text, flags=re.I):
    insertion = '  <touch mouseEmulation="no" />\n'
    if re.search(r'</openbox_config\s*>', text, flags=re.I):
        text = re.sub(r'(</openbox_config\s*>)', insertion + r'\1', text, count=1, flags=re.I)
    elif re.search(r'<openbox_config\b[^>]*/>', text, flags=re.I):
        def expand(m: re.Match[str]) -> str:
            tag = m.group(0).rstrip()
            tag = re.sub(r'/\s*>$', '>', tag)
            return tag + '\n' + insertion + '</openbox_config>'
        text = re.sub(r'<openbox_config\b[^>]*/>', expand, text, count=1, flags=re.I)

if text != original:
    path.write_text(text, encoding='utf-8')
    print('[touch] labwc touchscreen mouse emulation disabled')
else:
    print('[touch] labwc touchscreen config already uses native touch events')
PY

# When called from the labwc autostart environment this applies immediately.
# If LABWC_PID is unavailable, the change takes effect on the next login/reboot.
if command -v labwc >/dev/null 2>&1 && [ -n "${LABWC_PID:-}" ]; then
  labwc --reconfigure >/dev/null 2>&1 || true
fi
