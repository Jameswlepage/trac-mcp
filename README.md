# WordPress Trac MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with comprehensive access to WordPress.org Trac data. Built with TypeScript and deployed on Cloudflare Workers.

## Overview

This MCP server transforms WordPress Trac into an AI-accessible knowledge base, enabling intelligent queries about WordPress development, ticket tracking, and code changes.

## Features

- Search 60,000+ WordPress tickets by keywords, components, or status
- Get detailed ticket information including descriptions, status, and metadata
- Access changeset information with full diff content
- Monitor recent WordPress development activity
- Retrieve project metadata like components, milestones, and priorities
- WordPress-branded UI with official styling

## Available Tools

### searchTickets
Search through WordPress Trac tickets with intelligent filtering.

```json
{
  "tool": "searchTickets",
  "args": {
    "query": "REST API performance",
    "limit": 10,
    "status": "open"
  }
}
```

### getTicket
Retrieve comprehensive information about specific tickets.

```json
{
  "tool": "getTicket",
  "args": {
    "id": 59166,
    "includeComments": true
  }
}
```

### getChangeset
Access detailed information about code commits and changes.

```json
{
  "tool": "getChangeset",
  "args": {
    "revision": 55567,
    "includeDiff": true,
    "diffLimit": 2000
  }
}
```

### getTimeline
Monitor recent WordPress development activity.

```json
{
  "tool": "getTimeline",
  "args": {
    "days": 7,
    "limit": 20
  }
}
```

### getTracInfo
Get organizational data like components and milestones.

```json
{
  "tool": "getTracInfo",
  "args": {
    "type": "components"
  }
}
```

## Installation

### Deploy to Cloudflare Workers

```bash
# Clone the repository
git clone https://github.com/Jameswlepage/trac-mcp.git
cd trac-mcp

# Install dependencies
npm install

# Login to Cloudflare
wrangler login

# Deploy
npm run deploy
```

### Connect to AI Assistant

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wordpress-trac": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-worker-url/mcp"]
    }
  }
}
```

## Development

### Local Development

```bash
# Start development server
npm run dev

# Test with MCP Inspector
npx @modelcontextprotocol/inspector http://localhost:8787/mcp
```

### Testing

```bash
# Run type checking
npm run type-check

# Run linting
npm run lint

# Test deployment
curl https://your-worker-url/health
```

## Architecture

- **Runtime**: Cloudflare Workers for global edge deployment
- **Language**: TypeScript with Zod validation
- **Protocol**: Model Context Protocol (MCP) for universal AI compatibility
- **APIs**: Public WordPress Trac CSV/RSS endpoints (no authentication required)

## Live Demo

**URL**: https://mcp-server-wporg-trac-staging.a8cai.workers.dev

## License

MIT License - feel free to use, modify, and distribute.

## Contributing

Contributions are welcome! This server demonstrates how to build production-ready MCP servers with real-world complexity and WordPress integration.