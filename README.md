# OpenNeuro MCP Server

An MCP (Model Context Protocol) server that provides GraphQL query access to the OpenNeuro neuroimaging dataset API. OpenNeuro is a free and open platform for sharing MRI, MEG, EEG, iEEG, and ECoG data.

## License and Citation

This project is available under the MIT License with an Academic Citation Requirement. This means you can freely use, modify, and distribute the code, but any academic or scientific publication that uses this software must provide appropriate attribution.

### For academic/research use:
If you use this software in a research project that leads to a publication, presentation, or report, you **must** cite this work according to the format provided in [CITATION.md](CITATION.md).

### For commercial/non-academic use:
Commercial and non-academic use follows the standard MIT License terms without the citation requirement.

By using this software, you agree to these terms. See [LICENSE.md](LICENSE.md) for the complete license text.

## Features

- **GraphQL Query Tool**: Execute GraphQL queries against the OpenNeuro API
- **Schema Introspection**: Discover available fields and operations
- **Dataset Access**: Query neuroimaging datasets, snapshots, and file listings
- **No Authentication Required**: Access public OpenNeuro data without API keys

## Installation & Development

1. Clone this repository:
```bash
git clone https://github.com/quentincody/open-neuro-mcp-server.git
cd open-neuro-mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The server will be available at `http://localhost:8787/sse`

## Deployment

Deploy to Cloudflare Workers:
```bash
npm run deploy
```

Your MCP server will be deployed to: `open-neuro-mcp-server.quentincody.workers.dev/sse`

## Usage

### Connect to Claude Desktop

To connect this MCP server to Claude Desktop, follow [Anthropic's Quickstart](https://modelcontextprotocol.io/quickstart/user) and edit your Claude Desktop configuration.

In Claude Desktop, go to Settings > Developer > Edit Config and add:

```json
{
  "mcpServers": {
    "openneuro": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://open-neuro-mcp-server.quentincody.workers.dev/sse"
      ]
    }
  }
}
```

For local development, use:
```json
{
  "mcpServers": {
    "openneuro": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8787/sse"
      ]
    }
  }
}
```

Restart Claude Desktop and the OpenNeuro tools will become available.

### Example Queries

The server provides an `openneuro_graphql_query` tool. Here are some example GraphQL queries:

**Get dataset information:**
```graphql
{
  dataset(id: "ds000224") {
    id
    name
    description
    created
  }
}
```

**List files in a snapshot:**
```graphql
{
  snapshot(datasetId: "ds000001", tag: "1.0.0") {
    files {
      filename
      size
    }
  }
}
```

**Schema introspection:**
```graphql
{
  __schema {
    queryType {
      name
      fields {
        name
        description
      }
    }
  }
}
``` 
