import { McpAgent } from "agents/mcp"; // Assuming McpAgent is available via this path as per the example.
                                        // This might be a project-local base class or an alias to an SDK import.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Define our OpenNeuro MCP agent
export class OpenNeuroMCP extends McpAgent {
	server = new McpServer({
		name: "OpenNeuroExplorer",
		version: "0.1.0",
		description: "MCP Server for querying the OpenNeuro GraphQL API. OpenNeuro is a free and open platform for sharing MRI, MEG, EEG, iEEG, and ECoG data."
	});

	// OpenNeuro API Configuration
	private readonly OPENNEURO_GRAPHQL_ENDPOINT = 'https://openneuro.org/crn/graphql';

	async init() {
		console.error("OpenNeuro MCP Server initialized.");

		// Register the GraphQL execution tool
		this.server.tool(
			"openneuro_graphql_query",
			`Executes GraphQL queries against OpenNeuro API (https://openneuro.org/crn/graphql) for neuroimaging datasets (MRI, MEG, EEG). 
Query dataset info, snapshot details, file listings, etc. 
Example (dataset): '{ dataset(id: "ds000224") { id name } }'. 
Example (snapshot files): '{ snapshot(datasetId: "ds000001", tag: "1.0.0") { files { filename size } } }'. 
For directory contents, use 'tree' arg with dir ID. 
IMPORTANT: Before any data query/mutation, ALWAYS run introspection queries (e.g., '{ __schema { queryType { name } types { name fields { name } } } }') to confirm all target fields/operations are in the schema. This prevents errors from schema changes. 
If a query fails, re-check syntax & re-introspect. Refer to API docs (schema at endpoint) for details.`,
			{
				query: z.string().describe(
					"The GraphQL query string to execute against the OpenNeuro GraphQL API (https://openneuro.org/crn/graphql). " +
					"Example: '{ dataset(id: \"ds000224\") { id name } }'. " +
					"Use introspection queries like '{ __schema { queryType { name } types { name kind } } }' to discover the schema. "
				),
				variables: z.record(z.any()).optional().describe(
					"Optional dictionary of variables for the GraphQL query. Example: { \"datasetId\": \"ds000224\" }"
				),
			},
			async ({ query, variables }: { query: string; variables?: Record<string, any> }) => {
				console.error(`Executing openneuro_graphql_query with query: ${query.slice(0, 200)}...`);
				if (variables) {
					console.error(`With variables: ${JSON.stringify(variables).slice(0,150)}...`);
				}
				
				const result = await this.executeOpenNeuroGraphQLQuery(query, variables);
				
				return { 
					content: [{ 
						type: "text", 
						// Pretty print JSON for easier reading by humans, and parsable by LLMs.
						text: JSON.stringify(result, null, 2) 
					}]
				};
			}
		);
	}

	// Helper function to execute OpenNeuro GraphQL queries
	private async executeOpenNeuroGraphQLQuery(query: string, variables?: Record<string, any>): Promise<any> {
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"User-Agent": "MCPOpenNeuroServer/0.1.0 (ModelContextProtocol; +https://modelcontextprotocol.io)"
				// Note: OpenNeuro API documentation does not explicitly state need for API key for public queries.
				// If authentication is required for certain operations, an 'Authorization' header would be added here.
			};
			
			const bodyData: Record<string, any> = { query };
			if (variables) {
				bodyData.variables = variables;
			}
			
			console.error(`Making GraphQL request to: ${this.OPENNEURO_GRAPHQL_ENDPOINT}`);

			const response = await fetch(this.OPENNEURO_GRAPHQL_ENDPOINT, {
				method: 'POST',
				headers,
				body: JSON.stringify(bodyData),
			});
			
			console.error(`OpenNeuro API response status: ${response.status}`);
			
			let responseBody;
			try {
				responseBody = await response.json();
			} catch (e) {
				const errorText = await response.text();
				console.error(`OpenNeuro API response is not JSON. Status: ${response.status}, Body: ${errorText.slice(0,500)}`);
				return {
					errors: [{
						message: `OpenNeuro API Error ${response.status}: Non-JSON response.`,
						extensions: {
							statusCode: response.status,
							responseText: errorText.slice(0, 1000) // Truncate long non-JSON responses
						}
					}]
				};
			}

			if (!response.ok) {
				console.error(`OpenNeuro API HTTP Error ${response.status}: ${JSON.stringify(responseBody)}`);
				return {
					errors: [{ 
						message: `OpenNeuro API HTTP Error ${response.status}`,
						extensions: {
							statusCode: response.status,
							responseBody: responseBody 
						}
					}]
				};
			}
			
			return responseBody; // Contains `data` and/or `errors` field from GraphQL

		} catch (error) {
			console.error(`Client-side error during OpenNeuro GraphQL request: ${error instanceof Error ? error.message : String(error)}`);
			let errorMessage = "An unexpected client-side error occurred while attempting to query the OpenNeuro GraphQL API.";
			if (error instanceof Error) {
					errorMessage = error.message;
			} else {
					errorMessage = String(error);
			}
			return { 
				errors: [{ 
					message: errorMessage,
                    extensions: {
                        clientError: true 
                    }
				}]
			};
		}
	}}

// Define the Env interface for environment variables.
// For this server, no specific environment variables are strictly needed for basic OpenNeuro API access.
interface Env {
	MCP_HOST?: string; // Standard MCP env var
	MCP_PORT?: string; // Standard MCP env var
	// OPENNEURO_API_KEY?: string; // If an API key were needed, it would be defined here
}

// Dummy ExecutionContext for type compatibility, usually provided by the runtime environment.
interface ExecutionContext {
	waitUntil(promise: Promise<any>): void;
	passThroughOnException(): void;
}

// Export the fetch handler, standard for environments like Cloudflare Workers or Deno Deploy.
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// SSE transport is primary as requested
		if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
			// @ts-ignore - This is used in the example, presumably to handle potential slight
            // mismatches between the generic `fetch` signature expected by some runtimes
            // and the specific signature of the `fetch` method returned by `serveSSE`.
			return OpenNeuroMCP.serveSSE("/sse").fetch(request, env, ctx);
		}
		
		// Fallback for unhandled paths
		console.error(`OpenNeuro MCP Server. Requested path ${url.pathname} not found. Listening for SSE on /sse.`);
		
		return new Response(
			`OpenNeuro MCP Server - Path not found.\nAvailable MCP paths:\n- /sse (for Server-Sent Events transport)`, 
			{ 
				status: 404,
				headers: { "Content-Type": "text/plain" }
			}
		);
	},
};

// Export the Durable Object class (or main class for other environments)
export { OpenNeuroMCP as MyMCP };