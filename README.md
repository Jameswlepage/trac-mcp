# WordPress Trac MCP Server

A production-ready Model Context Protocol (MCP) server for WordPress Trac integration, deployed on Cloudflare Workers.

## Overview

This MCP server provides AI assistants with read-only access to WordPress Trac data, enabling them to:
- Search tickets by keyword or filter
- Retrieve detailed ticket information including comments
- Access changeset/commit information
- Get timeline events and project metadata

## Features

- **Production-ready**: Built with TypeScript, proper error handling, and comprehensive logging
- **Scalable**: Deployed on Cloudflare Workers for global edge performance
- **Secure**: Read-only access to public WordPress Trac data
- **Standards-compliant**: Follows MCP specification for universal AI compatibility
- **Comprehensive**: 5 tools covering all major Trac operations

## Quick Start

### Prerequisites

- Node.js 18+ installed
- Cloudflare account
- Wrangler CLI installed globally: `npm install -g wrangler`

### 1. Clone and Setup

```bash
git clone https://github.com/yourusername/wordpress-trac-mcp-server.git
cd wordpress-trac-mcp-server
npm install
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Deploy to Cloudflare Workers

```bash
# Deploy to development
npm run deploy

# Deploy to production
npm run deploy:production
```

### 4. Test the Deployment

```bash
# Test the health endpoint
curl https://your-worker-name.your-subdomain.workers.dev/health

# Test the info endpoint
curl https://your-worker-name.your-subdomain.workers.dev/
```

## Local Development

### Start Development Server

```bash
npm run dev
```

The server will be available at:
- **SSE endpoint**: `http://localhost:8787/sse`
- **MCP endpoint**: `http://localhost:8787/mcp`
- **Health check**: `http://localhost:8787/health`

### Testing with MCP Inspector

1. Install MCP Inspector: `npm install -g @modelcontextprotocol/inspector`
2. Start your dev server: `npm run dev`
3. Run inspector: `mcp-inspector http://localhost:8787/sse`

## MCP Tools

### 1. searchTickets

Search WordPress Trac tickets by keywords or filters.

**Parameters:**
- `query` (string): Search query or filter expression
- `limit` (number, optional): Maximum results (1-50, default: 10)
- `status` (enum, optional): Filter by status ("open", "closed", "all", default: "all")
- `component` (string, optional): Filter by component name

**Example:**
```json
{
  "tool": "searchTickets",
  "args": {
    "query": "REST API",
    "limit": 5,
    "status": "open"
  }
}
```

### 2. getTicket

Get detailed information about a specific ticket.

**Parameters:**
- `id` (number): Ticket ID
- `includeComments` (boolean, optional): Include comments (default: true)
- `commentLimit` (number, optional): Max comments to return (0-100, default: 20)

**Example:**
```json
{
  "tool": "getTicket",
  "args": {
    "id": 12345,
    "includeComments": true,
    "commentLimit": 10
  }
}
```

### 3. getChangeset

Get information about a specific changeset/commit.

**Parameters:**
- `revision` (number): SVN revision number
- `includeDiff` (boolean, optional): Include diff content (default: true)
- `diffLimit` (number, optional): Max diff characters (0-5000, default: 2000)

**Example:**
```json
{
  "tool": "getChangeset",
  "args": {
    "revision": 58504,
    "includeDiff": true,
    "diffLimit": 1000
  }
}
```

### 4. getTracInfo

Get Trac metadata like components, milestones, priorities, etc.

**Parameters:**
- `type` (enum): Type of info ("components", "milestones", "priorities", "severities")

**Example:**
```json
{
  "tool": "getTracInfo",
  "args": {
    "type": "components"
  }
}
```

### 5. getTimeline

Get recent timeline events from WordPress Trac.

**Parameters:**
- `days` (number, optional): Days to look back (1-30, default: 7)
- `limit` (number, optional): Max events to return (1-100, default: 20)

**Example:**
```json
{
  "tool": "getTimeline",
  "args": {
    "days": 3,
    "limit": 15
  }
}
```

## Connecting to AI Clients

### Claude Desktop

1. Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wordpress-trac": {
      "command": "mcp-remote",
      "args": ["https://your-worker-name.your-subdomain.workers.dev/sse"]
    }
  }
}
```

2. Install mcp-remote: `npm install -g mcp-remote`
3. Restart Claude Desktop

### Cloudflare AI Playground

1. Go to [Cloudflare AI Playground](https://playground.ai.cloudflare.com/)
2. Add your worker URL as an MCP server
3. Test the connection

### Custom MCP Client

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const client = new Client({
  name: "my-client",
  version: "1.0.0"
});

// Connect to SSE endpoint
await client.connect("https://your-worker-name.your-subdomain.workers.dev/sse");

// Call a tool
const result = await client.callTool("searchTickets", {
  query: "gutenberg",
  limit: 5
});
```

## Configuration

### Environment Variables

Set in `wrangler.toml` under `[vars]`:

- `ENVIRONMENT`: "development" or "production"

### Custom Domain

Add to `wrangler.toml`:

```toml
routes = [
  { pattern = "trac-mcp.yourdomain.com/*", zone_id = "your-zone-id" }
]
```

### Rate Limiting

The server includes built-in rate limiting via WordPress Trac's own limits. For additional protection, consider:

1. **Cloudflare Rate Limiting**: Set up rules in your Cloudflare dashboard
2. **Worker KV**: Implement request tracking using KV storage
3. **D1 Database**: Use D1 for more sophisticated rate limiting

## Monitoring and Observability

### Built-in Monitoring

The server includes:
- Health check endpoint at `/health`
- Comprehensive error handling and logging
- Request/response timing

### Cloudflare Analytics

Enable in `wrangler.toml`:

```toml
[analytics_engine_datasets]
[[analytics_engine_datasets.bindings]]
name = "ANALYTICS"
dataset = "mcp_analytics"
```

### Custom Metrics

Add metrics tracking:

```typescript
// In your tool handlers
env.ANALYTICS?.writeDataPoint({
  blobs: ["searchTickets", query],
  doubles: [performance.now() - startTime],
  indexes: [Date.now()]
});
```

## Production Considerations

### Security

- **CORS**: Configured for AI client access
- **Read-only**: No write operations to Trac
- **Rate limiting**: Respects Trac's usage policies
- **Input validation**: All inputs validated with Zod schemas

### Performance

- **Edge deployment**: Runs on Cloudflare's global edge network
- **Concurrent requests**: Handles multiple parallel tool calls
- **Response caching**: Consider adding KV caching for frequently accessed tickets
- **Diff limiting**: Large diffs are automatically truncated

### Reliability

- **Error handling**: Comprehensive error handling with fallbacks
- **Timeout handling**: Proper timeout management for external requests
- **Health checks**: Built-in health monitoring
- **Graceful degradation**: Continues working even if some features fail

## Troubleshooting

### Common Issues

1. **"Module not found" errors**: Run `npm install` and ensure all dependencies are installed
2. **Wrangler authentication**: Run `wrangler login` to authenticate with Cloudflare
3. **Trac API errors**: Check if WordPress Trac is accessible and XML-RPC is enabled
4. **CORS issues**: Ensure your client is configured to handle cross-origin requests

### Debug Mode

Enable debug logging:

```bash
wrangler dev --debug
```

### Logs

View production logs:

```bash
wrangler tail
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/wordpress-trac-mcp-server/issues)
- **MCP Documentation**: [Model Context Protocol](https://modelcontextprotocol.io/)
- **Cloudflare Workers**: [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- **WordPress Trac**: [WordPress Trac](https://core.trac.wordpress.org/)