---
name: copy
description: Copy text to the user's clipboard. Use when the user wants to copy generated content, summaries, or any text to their clipboard.
allowed-tools: Bash
---

# Copy to Clipboard Skill

Copy text content to the user's system clipboard.

## Platform Detection

Detect the platform and use the appropriate command:
- **macOS**: `pbcopy`
- **Linux**: `xclip -selection clipboard` (or `xsel --clipboard`)

## Usage

For multi-line content, use a heredoc with the appropriate clipboard command:

**macOS:**
```bash
cat <<'EOF' | pbcopy
Your content here
Multiple lines supported
EOF
```

**Linux:**
```bash
cat <<'EOF' | xclip -selection clipboard
Your content here
Multiple lines supported
EOF
```

## Cross-Platform Detection

Check the OS before copying:
```bash
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  cat <<'EOF' | pbcopy
content
EOF
elif command -v xclip &> /dev/null; then
  # Linux with xclip
  cat <<'EOF' | xclip -selection clipboard
content
EOF
else
  echo "No clipboard utility found"
fi
```

## Important Notes

- Always confirm to the user that content was copied
- For large content, consider showing a preview before copying
- On Linux, `xclip` may need to be installed (`apt install xclip`)
