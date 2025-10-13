# Obsidian Agent Plugin

An Obsidian plugin that integrates Claude's Agent SDK to help you organize, search, and maintain your vault using natural language commands.

## Features

- 🤖 **Natural Language Control** - Ask the agent to organize notes, search content, or manage your vault
- 🔗 **Smart Linking** - Automatically suggests and creates [[wiki links]] between related concepts
- 🔍 **Powerful Search** - Full-text search and backlink discovery
- 🌐 **Web Integration** - Search the web, fetch content from URLs, and incorporate external information
- 📝 **Flexible Inbox Processing** - Process captures from your inbox (daily notes, scratchpad, etc.) into organized permanent notes
- 🛑 **Stop Button** - Interrupt the agent anytime with a dedicated stop button
- ✨ **Modern UI** - Smooth animations, thinking indicator, and polished chat interface
- ⚙️ **Fully Customizable** - Edit workflow preferences to match your PKM system and vault structure
- 🛠️ **Obsidian-Specific Tools**:
  - `list_pages()` - List all markdown files organized by folder
  - `search_vault(query)` - Full-text search across your vault
  - `get_backlinks(page)` - Find pages that link TO a specific page
  - `get_outgoing_links(page)` - Find what a page links TO
  - `get_daily_note(date)` - Get path to daily notes

Plus access to all Claude Code built-in tools (Read, Edit, Write, Bash, Glob, Grep)!

## Prerequisites

### Required

1. **Obsidian Desktop** - This plugin only works on desktop (not mobile)
2. **Claude Code CLI** - Install the Claude Code command-line tool
   - Install: `npm install -g @anthropic-ai/claude-code`
   - Or download from [Claude Code releases](https://github.com/anthropics/claude-code)
3. **Anthropic API Key** - Configure Claude Code with your API key
   - Get key: [Anthropic Console](https://console.anthropic.com/)
   - Configure: Run `claude config` in your terminal

### Verification

Test that Claude Code is working:
```bash
claude --version
```

## Installation

### Manual Installation

1. Download the latest release from the [Releases page](../../releases)
2. Extract the files to your vault's plugins folder:
   ```
   <vault>/.obsidian/plugins/obsidian-agent/
   ```
3. The folder should contain:
   - `main.js`
   - `manifest.json`
   - `styles.css` (if present)
4. Reload Obsidian
5. Enable "Obsidian Agent" in Settings → Community Plugins

### BRAT Installation (for beta testing)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Add this repository: `szweibel/obsidian-agent-plugin`
3. BRAT will auto-update the plugin when new versions are released

## Configuration

### First Time Setup

1. Open **Settings → Obsidian Agent**
2. Click **"Auto-Detect"** to find your Claude Code CLI path
   - If auto-detect fails, manually enter the path (e.g., `C:\Users\YourName\.local\bin\claude.exe` on Windows)
3. (Optional) Customize the **Workflow Preferences** to match your vault

### Workflow Customization

The workflow preferences control how the agent organizes your vault. You can customize:

- **Folder Structure** - Update folder names to match your vault (e.g., change `Library/` to `Work/`)
- **Inbox System** - Configure for daily notes, scratchpad, inbox file, or your own system
- **Processing Workflow** - Modify how the agent processes and organizes content
- **Linking Philosophy** - Adjust how aggressively the agent creates links

**Examples:**
- Daily notes workflow: Change `Scratchpad.md` to `Daily/YYYY-MM-DD.md` throughout the workflow
- Custom inbox: Use `Inbox.md`, `Capture.md`, or whatever you prefer
- Different folder names: Replace `Library/` with your own folder structure

**Note:** The default workflow uses Scratchpad.md as an inbox, but you can easily customize it. Core rules and tool descriptions are protected - only workflow preferences are customizable.

## Usage

### Opening the Agent Chat

- **Ribbon Icon**: Click the bot icon in the left sidebar
- **Command Palette**: `Cmd/Ctrl+P` → "Open Agent Chat"
- **Keyboard Shortcut**: Configure in Settings → Hotkeys

### Example Commands

**Search and Explore:**
- "Search for 'teaching' in my vault"
- "What pages link to the Teaching page?"
- "Show me all notes in the Library folder"

**Web Integration:**
- "Search the web for recent developments in AI and summarize them"
- "Fetch the content from this URL and create a note"
- "Find information about Zettelkasten method and add it to my vault"

**Organization:**
- "Process my scratchpad" or "Process my daily notes from the last week"
- "Organize the captures into separate notes"
- "Move the content about books to a new Books note"
- "Create atomic notes from my inbox"

**Linking:**
- "Find related notes that should link to this Teaching Philosophy page"
- "What concepts in this note deserve their own atomic notes?"

**Settings:**
- "Turn on line numbers in Obsidian"
- "Show me my Obsidian settings"

### Chat Features

- **Clickable Links** - Click [[wiki links]] in responses to open notes
- **Tool Indicators** - See what tools the agent is using (shown as *🔧 tool_name*)
- **Thinking Indicator** - Animated indicator shows when the agent is processing
- **Stop Button** - Interrupt the agent mid-response if needed
- **Clear Button** - Start a fresh conversation (clears history)
- **Session Memory** - Agent remembers the entire conversation until you clear it
- **Modern UI** - Smooth animations, polished styling, and professional appearance

## Troubleshooting

### "Claude Code executable not found"

**Solution:**
1. Verify Claude Code is installed: `claude --version`
2. Go to Settings → Obsidian Agent
3. Click "Auto-Detect" or manually enter the CLI path
4. Common paths:
   - **Mac/Linux**: `~/.local/bin/claude` or `/usr/local/bin/claude`
   - **Windows**: `C:\Users\YourName\.local\bin\claude.exe`

### "Permission denied" or API errors

**Solution:**
1. Verify your API key is configured: `claude config`
2. Check your API key at [Anthropic Console](https://console.anthropic.com/)
3. Ensure you have API credits available

### Agent isn't using tools or following instructions

**Solution:**
1. Check the browser console (Ctrl+Shift+I / Cmd+Option+I)
2. Look for `[ObsidianAgent]` log messages
3. Try clearing the chat and starting a new session
4. Verify the workflow preferences in settings haven't been corrupted

### Agent suggestions don't match my vault structure

**Solution:**
1. Open Settings → Obsidian Agent
2. Edit the Workflow Preferences to match your folder names and workflow
3. Update references like `Library/`, `Scratchpad.md`, etc. to match your vault

## Privacy & Security

- **Local Processing** - All vault operations happen locally on your machine
- **API Calls** - The plugin sends your queries and vault content to Anthropic's API via Claude Code
- **No Telemetry** - This plugin doesn't collect any usage data
- **Permissions** - The agent runs with `bypassPermissions` mode for seamless file operations

**Important**: Be mindful that vault content is sent to Anthropic's API. Don't use this plugin with sensitive/confidential information unless you're comfortable with that.

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/szweibel/obsidian-agent-plugin.git
cd obsidian-agent-plugin

# Install dependencies
npm install

# Build
npm run build

# Development (watch mode)
npm run dev
```

### Project Structure

```
src/
  main.ts       - Main plugin class, tools, and chat UI
  settings.ts   - Settings interface and UI
dist/
  main.js       - Built plugin (generated)
manifest.json   - Plugin metadata
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details

## Credits

- Built with [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
- Uses [Obsidian Plugin API](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- Inspired by the Zettelkasten and PKM communities

## Support

- **Issues**: [GitHub Issues](../../issues)
- **Discussions**: [GitHub Discussions](../../discussions)
- **Documentation**: [Obsidian Forum Thread](link-to-forum-thread)

---

**Note**: This plugin is not officially affiliated with Obsidian or Anthropic.
