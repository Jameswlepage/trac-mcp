import { z } from "zod";

// WordPress Trac public API endpoints
const TRAC_BASE_URL = "https://core.trac.wordpress.org";


// JSON-RPC 2.0 message schemas
const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.any().optional(),
  id: z.union([z.string(), z.number()]).optional(),
});

// In-memory cache for ticket details
const ticketCache = new Map<number, any>();

/**
 * Lightweight XML-RPC client for Trac API calls
 */
class TracXmlRpcClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private buildXmlRpcRequest(method: string, params: any[]): string {
    const paramXml = params.map(param => {
      if (typeof param === 'string') {
        return `<param><value><string>${this.escapeXml(param)}</string></value></param>`;
      } else if (typeof param === 'number') {
        return `<param><value><int>${param}</int></value></param>`;
      } else if (typeof param === 'boolean') {
        return `<param><value><boolean>${param ? '1' : '0'}</boolean></value></param>`;
      } else if (Array.isArray(param)) {
        const arrayItems = param.map(item => `<value><string>${this.escapeXml(String(item))}</string></value>`).join('');
        return `<param><value><array><data>${arrayItems}</data></array></value></param>`;
      } else {
        return `<param><value><string>${this.escapeXml(String(param))}</string></value></param>`;
      }
    }).join('');

    return `<?xml version="1.0"?>
<methodCall>
  <methodName>${method}</methodName>
  <params>
    ${paramXml}
  </params>
</methodCall>`;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  private parseXmlRpcResponse(xml: string): any {
    // Simple XML parsing for XML-RPC response
    const faultMatch = xml.match(/<fault>[\s\S]*?<\/fault>/);
    if (faultMatch) {
      const faultCodeMatch = xml.match(/<name>faultCode<\/name>\s*<value><int>(\d+)<\/int><\/value>/);
      const faultStringMatch = xml.match(/<name>faultString<\/name>\s*<value><string>(.*?)<\/string><\/value>/);
      throw new Error(`XML-RPC Fault ${faultCodeMatch?.[1] || 'Unknown'}: ${faultStringMatch?.[1] || 'Unknown error'}`);
    }

    // Extract the response value
    const valueMatch = xml.match(/<methodResponse>\s*<params>\s*<param>\s*<value>([\s\S]*?)<\/value>\s*<\/param>\s*<\/params>\s*<\/methodResponse>/);
    if (!valueMatch?.[1]) {
      throw new Error('Invalid XML-RPC response format');
    }

    return this.parseValue(valueMatch[1]);
  }

  private parseValue(valueXml: string): any {
    valueXml = valueXml.trim();
    
    if (valueXml.startsWith('<string>')) {
      return valueXml.replace(/<\/?string>/g, '');
    } else if (valueXml.startsWith('<int>')) {
      return parseInt(valueXml.replace(/<\/?int>/g, ''), 10);
    } else if (valueXml.startsWith('<boolean>')) {
      return valueXml.replace(/<\/?boolean>/g, '') === '1';
    } else if (valueXml.startsWith('<array>')) {
      const dataMatch = valueXml.match(/<data>([\s\S]*?)<\/data>/);
      if (!dataMatch?.[1]) return [];
      
      const values = [];
      const valueMatches = dataMatch[1]?.match(/<value>([\s\S]*?)<\/value>/g);
      if (valueMatches) {
        for (const valueMatch of valueMatches) {
          const innerValue = valueMatch.replace(/<\/?value>/g, '');
          values.push(this.parseValue(innerValue));
        }
      }
      return values;
    } else if (valueXml.startsWith('<struct>')) {
      const obj: any = {};
      const memberMatches = valueXml.match(/<member>([\s\S]*?)<\/member>/g);
      if (memberMatches) {
        for (const memberMatch of memberMatches) {
          const nameMatch = memberMatch.match(/<name>(.*?)<\/name>/);
          const valueMatch = memberMatch.match(/<value>([\s\S]*?)<\/value>/);
          if (nameMatch?.[1] && valueMatch?.[1]) {
            obj[nameMatch[1]] = this.parseValue(valueMatch[1]);
          }
        }
      }
      return obj;
    } else {
      // Plain text value
      return valueXml;
    }
  }

  async call(method: string, params: any[] = []): Promise<any> {
    const requestBody = this.buildXmlRpcRequest(method, params);
    
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'User-Agent': 'WordPress-Trac-MCP-Server/1.0'
      },
      body: requestBody
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseText = await response.text();
    return this.parseXmlRpcResponse(responseText);
  }
}

// No client initialization needed - using public HTTP APIs

/**
 * Handle MCP JSON-RPC 2.0 requests
 */
async function handleMcpRequest(request: any): Promise<any> {
  const { method, params, id } = request;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            prompts: {},
          },
          serverInfo: {
            name: "WordPress Trac",
            version: "1.0.0",
          },
        },
      };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "searchTickets",
              description: "Search for WordPress Trac tickets by keyword or filter expression. Returns ticket summaries with basic info.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Search query for tickets (keywords or filter expressions like 'summary~=keyword')",
                  },
                  limit: {
                    type: "number",
                    description: "Maximum number of results to return (default: 10, max: 50)",
                    default: 10,
                  },
                  status: {
                    type: "string",
                    description: "Filter by ticket status (e.g., 'open', 'closed', 'new')",
                  },
                  component: {
                    type: "string", 
                    description: "Filter by component name (e.g., 'Administration', 'Posts, Post Types')",
                  },
                },
                required: ["query"],
              },
            },
            {
              name: "getTicket",
              description: "Get detailed information about a specific WordPress Trac ticket including description, comments, and metadata.",
              inputSchema: {
                type: "object",
                properties: {
                  id: {
                    type: "number",
                    description: "Trac ticket ID number",
                  },
                  includeComments: {
                    type: "boolean",
                    description: "Include ticket comments and discussion (default: true)",
                    default: true,
                  },
                  commentLimit: {
                    type: "number",
                    description: "Maximum number of comments to return (default: 10, max: 50)",
                    default: 10,
                  },
                },
                required: ["id"],
              },
            },
            {
              name: "getChangeset",
              description: "Get information about a specific WordPress code changeset/commit including commit message, author, and diff.",
              inputSchema: {
                type: "object",
                properties: {
                  revision: {
                    type: "number",
                    description: "SVN revision number (e.g., 58504)",
                  },
                  includeDiff: {
                    type: "boolean",
                    description: "Include diff content (default: true)",
                    default: true,
                  },
                  diffLimit: {
                    type: "number",
                    description: "Maximum characters of diff to return (default: 2000, max: 10000)",
                    default: 2000,
                  },
                },
                required: ["revision"],
              },
            },
            {
              name: "getTimeline",
              description: "Get recent activity from WordPress Trac timeline including recent tickets, commits, and other events.",
              inputSchema: {
                type: "object",
                properties: {
                  days: {
                    type: "number",
                    description: "Number of days to look back (default: 7, max: 30)",
                    default: 7,
                  },
                  limit: {
                    type: "number",
                    description: "Maximum number of events to return (default: 20, max: 100)",
                    default: 20,
                  },
                },
              },
            },
            {
              name: "getTracInfo",
              description: "Get WordPress Trac metadata like components, milestones, priorities, and severities.",
              inputSchema: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["components", "milestones", "priorities", "severities"],
                    description: "Type of Trac information to retrieve",
                  },
                },
                required: ["type"],
              },
            },
          ],
        },
      };

    case "tools/call":
      const { name, arguments: args } = params;
      
      try {
        let result;
        
        switch (name) {
          case "searchTickets": {
            const { query, limit = 10, status, component } = args;
            
            try {
              // Build Trac query URL
              const queryUrl = new URL('https://core.trac.wordpress.org/query');
              queryUrl.searchParams.set('format', 'csv');
              queryUrl.searchParams.set('max', Math.min(limit, 50).toString());
              
              // Add keyword search - try different approaches
              let searchApproach = 'summary';
              if (query.includes('=') || query.includes('~')) {
                // User provided a direct filter
                queryUrl.searchParams.set('summary', query);
              } else {
                // Search in summary with keyword
                queryUrl.searchParams.set('summary', `~${query}`);
              }
              
              // Add status filter
              if (status) {
                queryUrl.searchParams.set('status', status);
              }
              
              // Add component filter
              if (component) {
                queryUrl.searchParams.set('component', component);
              }

              // Query tickets with proper headers
              const response = await fetch(queryUrl.toString(), {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (compatible; WordPress-Trac-MCP-Server/1.0)',
                  'Accept': 'text/csv,text/plain,*/*',
                  'Accept-Language': 'en-US,en;q=0.9',
                }
              });
              
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }
              
              const csvData = await response.text();
              
              // Check if we got HTML instead of CSV (403 error)
              if (csvData.includes('<html>') || csvData.includes('403 Forbidden')) {
                // Fallback: try without search parameters
                const fallbackUrl = new URL('https://core.trac.wordpress.org/query');
                fallbackUrl.searchParams.set('format', 'csv');
                fallbackUrl.searchParams.set('max', Math.min(limit * 3, 100).toString()); // Get more to filter
                
                const fallbackResponse = await fetch(fallbackUrl.toString(), {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; WordPress-Trac-MCP-Server/1.0)',
                    'Accept': 'text/csv,text/plain,*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                  }
                });
                
                if (!fallbackResponse.ok) {
                  throw new Error(`Fallback query failed: ${fallbackResponse.status} ${fallbackResponse.statusText}`);
                }
                
                const fallbackData = await fallbackResponse.text();
                if (fallbackData.includes('<html>') || fallbackData.includes('403 Forbidden')) {
                  throw new Error('Access denied - both search and fallback queries returned HTML');
                }
                
                // Filter results client-side
                const allLines = fallbackData.trim().split('\n');
                const filteredLines = [allLines[0]]; // Keep header
                
                for (let i = 1; i < allLines.length; i++) {
                  const line = allLines[i];
                  if (line.toLowerCase().includes(query.toLowerCase())) {
                    filteredLines.push(line);
                    if (filteredLines.length > limit) break;
                  }
                }
                
                const result = { 
                  csvData: filteredLines.join('\n'), 
                  wasFiltered: true 
                };
                
                // Parse CSV data
                const lines = result.csvData.trim().split('\n');
                if (lines.length < 2) {
                  throw new Error('No tickets found matching search criteria');
                }
                
                const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
                const tickets = [];
                
                for (let i = 1; i < lines.length; i++) {
                  const line = lines[i].trim();
                  if (!line) continue;
                  
                  // Simple CSV parsing - handle quoted fields
                  const values = [];
                  let currentField = '';
                  let inQuotes = false;
                  
                  for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    if (char === '"' && (j === 0 || line[j-1] === ',')) {
                      inQuotes = true;
                    } else if (char === '"' && inQuotes && (j === line.length - 1 || line[j+1] === ',')) {
                      inQuotes = false;
                    } else if (char === ',' && !inQuotes) {
                      values.push(currentField.trim());
                      currentField = '';
                    } else {
                      currentField += char;
                    }
                  }
                  values.push(currentField.trim());
                  
                  if (values.length >= 2 && values[0] && !isNaN(parseInt(values[0]))) {
                    const ticket = {
                      id: parseInt(values[0]),
                      title: values[1] || '',
                      text: `#${values[0]}: ${values[1] || 'No summary'}\nStatus: ${values[2] || 'unknown'}\nOwner: ${values[3] || 'unassigned'}\nType: ${values[4] || 'unknown'}\nPriority: ${values[5] || 'unknown'}\nMilestone: ${values[6] || 'none'}`,
                      url: `https://core.trac.wordpress.org/ticket/${values[0]}`,
                      metadata: {
                        status: values[2] || 'unknown',
                        owner: values[3] || 'unassigned',
                        type: values[4] || 'unknown',
                        priority: values[5] || 'unknown',
                        milestone: values[6] || 'none',
                      },
                    };
                    
                    tickets.push(ticket);
                  }
                }

                return {
                  results: tickets,
                  query,
                  totalFound: tickets.length,
                  returned: tickets.length,
                  note: queryResult.wasFiltered ? 'Results filtered client-side due to search API limitations' : undefined,
                };
              }
              
              const queryResult = { csvData, wasFiltered: false };
              
              // Parse CSV data
              const lines = queryResult.csvData.trim().split('\n');
              if (lines.length < 2) {
                throw new Error('No tickets found or invalid CSV response');
              }
              
              const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
              const tickets = [];
              
              for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                // Simple CSV parsing - handle quoted fields
                const values = [];
                let currentField = '';
                let inQuotes = false;
                
                for (let j = 0; j < line.length; j++) {
                  const char = line[j];
                  if (char === '"' && (j === 0 || line[j-1] === ',')) {
                    inQuotes = true;
                  } else if (char === '"' && inQuotes && (j === line.length - 1 || line[j+1] === ',')) {
                    inQuotes = false;
                  } else if (char === ',' && !inQuotes) {
                    values.push(currentField.trim());
                    currentField = '';
                  } else {
                    currentField += char;
                  }
                }
                values.push(currentField.trim());
                
                if (values.length >= 2 && values[0] && !isNaN(parseInt(values[0]))) {
                  const ticket = {
                    id: parseInt(values[0]),
                    title: values[1] || '',
                    text: `#${values[0]}: ${values[1] || 'No summary'}\nStatus: ${values[4] || 'unknown'}\nOwner: ${values[2] || 'unassigned'}\nType: ${values[3] || 'unknown'}\nPriority: ${values[5] || 'unknown'}\nMilestone: ${values[6] || 'none'}`,
                    url: `https://core.trac.wordpress.org/ticket/${values[0]}`,
                    metadata: {
                      status: values[4] || 'unknown',
                      owner: values[2] || 'unassigned',
                      type: values[3] || 'unknown',
                      priority: values[5] || 'unknown',
                      milestone: values[6] || 'none',
                    },
                  };
                  
                  tickets.push(ticket);
                }
              }

              result = {
                results: tickets,
                query,
                totalFound: tickets.length,
                returned: tickets.length,
                note: queryResult.wasFiltered ? 'Results filtered client-side due to search API limitations' : undefined,
              };
            } catch (error) {
              result = {
                results: [],
                query,
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
            break;
          }

          case "getTicket": {
            const { id, includeComments = true, commentLimit = 10 } = args;
            
            try {
              // Use search approach since CSV parsing is problematic
              const searchUrl = new URL('https://core.trac.wordpress.org/query');
              searchUrl.searchParams.set('format', 'csv');
              searchUrl.searchParams.set('id', id.toString());
              searchUrl.searchParams.set('max', '1');
              
              const response = await fetch(searchUrl.toString());
              const csvData = await response.text();
              
              // Parse CSV data similar to searchTickets
              const lines = csvData.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
              if (lines.length < 2) {
                throw new Error(`Ticket ${id} not found`);
              }
              
              const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
              
              // Parse each line like in searchTickets
              for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                // Simple CSV parsing - handle quoted fields
                const values = [];
                let currentField = '';
                let inQuotes = false;
                
                for (let j = 0; j < line.length; j++) {
                  const char = line[j];
                  if (char === '"' && (j === 0 || line[j-1] === ',')) {
                    inQuotes = true;
                  } else if (char === '"' && inQuotes && (j === line.length - 1 || line[j+1] === ',')) {
                    inQuotes = false;
                  } else if (char === ',' && !inQuotes) {
                    values.push(currentField.trim());
                    currentField = '';
                  } else {
                    currentField += char;
                  }
                }
                values.push(currentField.trim());
                
                if (values.length >= 2 && values[0] && !isNaN(parseInt(values[0]))) {
                  const ticketId = parseInt(values[0]);
                  if (ticketId === id) {
                    // Map fields based on actual headers from search query
                    // Headers: id,Summary,Owner,Type,Status,Priority,Milestone
                    const ticket = {
                      id: parseInt(values[0]),
                      summary: values[1] || '',
                      owner: values[2] || '',
                      type: values[3] || '',
                      status: values[4] || '',
                      priority: values[5] || '',
                      milestone: values[6] || '',
                      reporter: '', // Not available in search query
                      description: 'Full description not available in search query. Visit the ticket URL for complete details.',
                      component: '', // Not available in search query
                      version: '',
                      severity: '',
                      resolution: '',
                      keywords: '',
                      cc: '',
                      focuses: '',
                    };

                    // Note: Comments are not available through the CSV API
                    let comments: any[] = [];
                    
                    if (includeComments) {
                      comments = [{
                        author: 'system',
                        timestamp: new Date().toISOString(),
                        comment: 'Comment history not available through CSV API. Visit the ticket URL for full discussion.',
                      }];
                    }

                    result = {
                      id: id,
                      title: `#${id}: ${ticket.summary}`,
                      text: `Ticket #${id}: ${ticket.summary}\n\nStatus: ${ticket.status}\nComponent: ${ticket.component}\nPriority: ${ticket.priority}\nType: ${ticket.type}\nReporter: ${ticket.reporter}\nOwner: ${ticket.owner}\nMilestone: ${ticket.milestone}\nVersion: ${ticket.version}\nKeywords: ${ticket.keywords}\n\nDescription:\n${ticket.description}\n\nFor full discussion and comments, visit: https://core.trac.wordpress.org/ticket/${id}`,
                      url: `https://core.trac.wordpress.org/ticket/${id}`,
                      metadata: {
                        ticket,
                        comments,
                        totalComments: comments.length,
                      },
                    };
                    break; // Found the ticket, exit the loop
                  }
                }
              }
              
              // If we didn't find the ticket, result will be undefined
              if (!result) {
                throw new Error(`Ticket ${id} not found`);
              }
            } catch (error) {
              result = {
                id: id,
                title: `Error loading ticket ${id}`,
                text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                url: `https://core.trac.wordpress.org/ticket/${id}`,
                metadata: { error: true },
              };
            }
            break;
          }

          case "getChangeset": {
            const { revision, includeDiff = true, diffLimit = 2000 } = args;
            
            try {
              const changesetUrl = `https://core.trac.wordpress.org/changeset/${revision}`;
              
              // Fetch changeset page
              const response = await fetch(changesetUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
              });

              if (!response.ok) {
                throw new Error(`Changeset ${revision} not found`);
              }

              const html = await response.text();
              
              // Parse changeset information from HTML with better patterns
              const messageMatch = html.match(/<div class="message"[^>]*>\s*<p[^>]*>(.*?)<\/p>/s) || 
                                  html.match(/<div class="message"[^>]*>(.*?)<\/div>/s);
              const authorMatch = html.match(/<dt>Author:<\/dt>\s*<dd>(.*?)<\/dd>/s) ||
                                 html.match(/<dt class="author">Author:<\/dt>\s*<dd class="author">(.*?)<\/dd>/s);
              const dateMatch = html.match(/<dt>Date:<\/dt>\s*<dd>(.*?)<\/dd>/s) ||
                               html.match(/<dt class="date">Date:<\/dt>\s*<dd class="date">(.*?)<\/dd>/s);
              
              const changeset = {
                revision,
                author: authorMatch?.[1] ? authorMatch[1].replace(/<[^>]*>/g, '').trim() : '',
                date: dateMatch?.[1] ? dateMatch[1].replace(/<[^>]*>/g, '').trim() : '',
                message: messageMatch?.[1] ? messageMatch[1].replace(/<[^>]*>/g, '').trim() : '',
                files: [] as string[],
                diff: '',
              };

              // Extract file list with better patterns
              const fileMatches = html.match(/<h2[^>]*>Files:<\/h2>([\s\S]*?)<\/div>/) ||
                                 html.match(/<div class="files"[^>]*>([\s\S]*?)<\/div>/);
              if (fileMatches?.[1]) {
                const fileListHtml = fileMatches[1];
                const filePathMatches = fileListHtml.match(/<a[^>]*href="[^"]*"[^>]*>(.*?)<\/a>/g) ||
                                       fileListHtml.match(/<li[^>]*>(.*?)<\/li>/g);
                if (filePathMatches) {
                  changeset.files = filePathMatches
                    .map(match => match.replace(/<[^>]*>/g, '').trim())
                    .filter(path => path && !path.includes('('));
                }
              }

              // Get diff if requested
              if (includeDiff) {
                try {
                  const diffUrl = `${changesetUrl}?format=diff`;
                  const diffResponse = await fetch(diffUrl, {
                    headers: {
                      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                  });

                  if (diffResponse.ok) {
                    let diffText = await diffResponse.text();
                    const maxDiffLength = Math.min(diffLimit, 10000);
                    if (diffText.length > maxDiffLength) {
                      diffText = diffText.substring(0, maxDiffLength) + '\n... [diff truncated] ...';
                    }
                    changeset.diff = diffText;
                  }
                } catch (error) {
                  console.warn('Failed to load diff:', error);
                }
              }

              result = {
                id: revision.toString(),
                title: `r${revision}: ${changeset.message}`,
                text: `Changeset r${revision}\nAuthor: ${changeset.author}\nDate: ${changeset.date}\n\nMessage:\n${changeset.message}\n\nFiles changed: ${changeset.files.length}\n${changeset.files.slice(0, 10).join('\n')}${changeset.files.length > 10 ? '\n...' : ''}\n\n${changeset.diff ? `Diff:\n${changeset.diff}` : 'No diff available'}`,
                url: changesetUrl,
                metadata: {
                  changeset,
                  totalFiles: changeset.files.length,
                },
              };
            } catch (error) {
              result = {
                id: revision.toString(),
                title: `Error loading changeset ${revision}`,
                text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                url: `https://core.trac.wordpress.org/changeset/${revision}`,
                metadata: { error: true },
              };
            }
            break;
          }

          case "getTimeline": {
            const { days = 7, limit = 20 } = args;
            
            try {
              const timelineUrl = `https://core.trac.wordpress.org/timeline?from=${days}%2Bdays+ago&max=${Math.min(limit, 100)}&format=rss`;
              
              const response = await fetch(timelineUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
              });

              if (!response.ok) {
                throw new Error(`Failed to fetch timeline: ${response.statusText}`);
              }

              const rssText = await response.text();
              
              // Simple RSS parsing
              const itemMatches = rssText.match(/<item>([\s\S]*?)<\/item>/g);
              const events = [];
              
              if (itemMatches) {
                for (const itemMatch of itemMatches) {
                  const titleMatch = itemMatch.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
                  const linkMatch = itemMatch.match(/<link>(.*?)<\/link>/);
                  const descMatch = itemMatch.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
                  const dateMatch = itemMatch.match(/<pubDate>(.*?)<\/pubDate>/);
                  const creatorMatch = itemMatch.match(/<dc:creator>(.*?)<\/dc:creator>/);
                  
                  if (titleMatch && linkMatch) {
                    events.push({
                      id: linkMatch[1],
                      title: titleMatch[1],
                      text: `${titleMatch[1]}\n\nAuthor: ${creatorMatch ? creatorMatch[1] : 'Unknown'}\nDate: ${dateMatch ? dateMatch[1] : 'Unknown'}\n\n${descMatch ? descMatch[1].replace(/<[^>]*>/g, '') : ''}`,
                      url: linkMatch[1],
                      metadata: {
                        date: dateMatch ? dateMatch[1] : '',
                        author: creatorMatch ? creatorMatch[1] : '',
                        description: descMatch ? descMatch[1].replace(/<[^>]*>/g, '') : '',
                      },
                    });
                  }
                }
              }

              result = {
                results: events,
                totalEvents: events.length,
                daysBack: days,
                timelineUrl: 'https://core.trac.wordpress.org/timeline',
              };
            } catch (error) {
              result = {
                results: [],
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
            break;
          }

          case "getTracInfo": {
            const { type } = args;
            
            try {
              let data: any = {};
              let uniqueValues = new Set<string>();
              
              // Get a sample of tickets to extract unique values for the requested field
              const queryUrl = new URL('https://core.trac.wordpress.org/query');
              queryUrl.searchParams.set('format', 'csv');
              queryUrl.searchParams.set('max', '1000'); // Get more tickets for better coverage
              
              const response = await fetch(queryUrl.toString());
              const csvData = await response.text();
              
              // Parse CSV data
              const lines = csvData.trim().split('\n');
              const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
              
              // Find the column index for the requested type
              let columnIndex = -1;
              switch (type) {
                case "components":
                  // Components are not in the default query, need different approach
                  throw new Error(`Components list not available in default query. Try using the search function instead.`);
                  break;
                case "milestones":
                  columnIndex = headers.indexOf('Milestone');
                  break;
                case "priorities":
                  columnIndex = headers.indexOf('Priority');
                  break;
                case "severities":
                  // Severities are not in the default query
                  throw new Error(`Severities list not available in default query. Try using the search function instead.`);
                  break;
                case "types":
                  columnIndex = headers.indexOf('Type');
                  break;
                case "statuses":
                  columnIndex = headers.indexOf('Status');
                  break;
                default:
                  throw new Error(`Unknown info type: ${type}. Available types: milestones, priorities, types, statuses`);
              }
              
              if (columnIndex === -1) {
                throw new Error(`Column not found for type: ${type}`);
              }
              
              // Extract unique values
              for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
                if (values[columnIndex] && values[columnIndex].trim()) {
                  uniqueValues.add(values[columnIndex].trim());
                }
              }
              
              data = Array.from(uniqueValues).sort();

              result = {
                id: type,
                title: `WordPress Trac ${type}`,
                text: `${type.charAt(0).toUpperCase() + type.slice(1)} available in WordPress Trac:\n\n${data.join('\n')}`,
                url: 'https://core.trac.wordpress.org/',
                metadata: {
                  type,
                  data,
                  total: data.length,
                },
              };
            } catch (error) {
              result = {
                id: type,
                title: `Error loading ${type}`,
                text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}. Available types: components, milestones, priorities, severities, types, statuses`,
                url: 'https://core.trac.wordpress.org/',
                metadata: { error: true },
              };
            }
            break;
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify(result, null, 2)
            }],
          },
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32603,
            message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        };
      }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}

// WordPress.com styled landing page
function getLandingPage(url: URL, versionInfo?: { id: string; tag?: string; timestamp: string }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WordPress Trac MCP Server</title>
  <link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAABILAAASCwAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      background: #ffffff;
      max-width: 600px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    
    h1 {
      font-family: 'EB Garamond', serif;
      font-weight: 500;
      font-size: 2.25rem;
      color: #1a1a1a;
      margin-bottom: 0.5rem;
    }
    
    h2 {
      font-family: 'EB Garamond', serif;
      font-weight: 500;
      font-size: 1.5rem;
      color: #1a1a1a;
      margin: 2rem 0 1rem 0;
    }
    
    h3 {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      font-weight: 600;
      font-size: 1.1rem;
      color: #1a1a1a;
      margin: 1.5rem 0 0.75rem 0;
    }
    
    p {
      margin-bottom: 1rem;
      color: #4a4a4a;
    }
    
    .subtitle {
      color: #666;
      margin-bottom: 2rem;
    }
    
    code {
      background: #f6f8fa;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 0.9em;
      color: #3f57e1;
    }
    
    .code-block {
      background: #f6f8fa;
      border: 1px solid #e1e4e8;
      border-radius: 6px;
      padding: 1rem;
      margin: 1rem 0;
      overflow-x: auto;
    }
    
    .code-block code {
      background: none;
      padding: 0;
      color: #24292e;
    }
    
    .mcp-tool {
      margin-bottom: 0.75rem;
    }
    
    .mcp-tool code {
      font-weight: 600;
    }
    
    a {
      color: #3f57e1;
      text-decoration: none;
    }
    
    a:hover {
      text-decoration: underline;
    }
    
    .footer {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid #e1e4e8;
      text-align: center;
      color: #666;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <h1>WordPress Trac MCP Server</h1>
  <p class="subtitle">Model Context Protocol server for WordPress.org Trac integration</p>
  
  <h2>Available Tools</h2>
  
  <div class="mcp-tool">
    <code>searchTickets</code> - Search for WordPress Trac tickets by keyword or filter
  </div>
  
  <div class="mcp-tool">
    <code>getTicket</code> - Get detailed information about a specific ticket
  </div>
  
  <div class="mcp-tool">
    <code>getChangeset</code> - Get information about a code changeset/commit
  </div>
  
  <div class="mcp-tool">
    <code>getTimeline</code> - Get recent activity from WordPress Trac
  </div>
  
  <div class="mcp-tool">
    <code>getTracInfo</code> - Get Trac metadata (components, milestones, priorities, severities)
  </div>
  
  <h2>Configuration</h2>
  <p><strong>For Claude Desktop:</strong></p>
  <div class="code-block">
    <code>{
  "mcpServers": {
    "wordpress-trac": {
      "command": "npx",
      "args": ["mcp-remote", "${url.origin}/mcp"]
    }
  }
}</code>
  </div>
  
  <div class="footer">
    <p><a href="https://core.trac.wordpress.org/">WordPress Trac</a> • <a href="https://modelcontextprotocol.io/">MCP Docs</a> • an experiment by <a href="https://automattic.ai">A8C AI</a></p>
    ${versionInfo ? `<p style="margin-top: 0.5rem; font-size: 0.8rem; color: #999;">
      Version: <code style="font-size: 0.8rem;">${versionInfo.id.substring(0, 8)}</code>
      ${versionInfo.tag ? ` • Tag: <code style="font-size: 0.8rem;">${versionInfo.tag}</code>` : ''}
      • Deployed: ${new Date(versionInfo.timestamp).toLocaleString()}
    </p>` : ''}
  </div>
</body>
</html>
  `;
}

// Environment interface
interface Env {
  ENVIRONMENT?: string;
  CF_VERSION_METADATA?: {
    id: string;
    tag?: string;
    timestamp: string;
  };
}

// Cloudflare Worker export
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve landing page at root
    if (url.pathname === "/") {
      const versionInfo = env.CF_VERSION_METADATA;
      return new Response(getLandingPage(url, versionInfo), {
        headers: { "Content-Type": "text/html" }
      });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // Handle MCP endpoint
    if (url.pathname === "/mcp") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      try {
        const body = await request.json();
        const mcpRequest = JsonRpcRequestSchema.parse(body);
        const response = await handleMcpRequest(mcpRequest);
        
        return new Response(JSON.stringify(response), {
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error",
          },
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }

    return new Response("Not found", { status: 404 });
  },
};