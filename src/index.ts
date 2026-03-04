import { McpAgent } from "agents/mcp"; // Assuming McpAgent is available via this path as per the example.
                                        // This might be a project-local base class or an alias to an SDK import.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { OpenNeuroDataDO } from "./do";

export { OpenNeuroDataDO };

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

		const env = this.env as unknown as { OPENNEURO_DATA_DO?: DurableObjectNamespace };

		// Register query_data and get_schema tools for staged data access
		registerQueryData(this.server, env);
		registerGetSchema(this.server, env);

		// Register the GraphQL execution tool
		this.server.tool(
			"openneuro_graphql_query",
			`Executes GraphQL queries against OpenNeuro API (https://openneuro.org/crn/graphql) for neuroimaging datasets (MRI, MEG, EEG).
Query dataset info, snapshot details, file listings, etc.
Example (dataset list): '{ datasets(first: 5, orderBy: { created: descending }) { edges { node { id name created } } } }'.
Example (single dataset): '{ dataset(id: "ds000224") { id name created } }'.
Example (snapshot files): '{ snapshot(datasetId: "ds000001", tag: "1.0.0") { files { filename size } } }'.
SCALAR FIELDS: 'created' and 'modified' are DateTime scalars — use bare 'created', NEVER 'created { date }' (that causes "must not have a selection since it's a scalar" errors).
For directory contents, use 'tree' arg with dir ID.
IMPORTANT: Before any data query/mutation, ALWAYS run introspection queries (e.g., '{ __schema { queryType { name } types { name fields { name } } } }') to confirm all target fields/operations are in the schema. This prevents errors from schema changes.
If a query fails, re-check syntax & re-introspect. Refer to API docs (schema at endpoint) for details.`,
			{
				query: z.string().describe(
					"The GraphQL query string to execute against the OpenNeuro GraphQL API (https://openneuro.org/crn/graphql). " +
					"Example: '{ dataset(id: \"ds000224\") { id name created } }'. " +
					"NOTE: 'created' and 'modified' are DateTime scalars — use them bare (e.g., 'created'), never as objects (e.g., 'created { date }' will error). " +
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

				// Auto-stage large responses into Durable Object SQLite
				const resultJson = JSON.stringify(result);
				if (shouldStage(resultJson.length) && env?.OPENNEURO_DATA_DO) {
					try {
						const staged = await stageToDoAndRespond(
							result,
							env.OPENNEURO_DATA_DO as any,
							"openneuro",
							undefined,
							undefined,
							"openneuro",
						);
						const stagedPayload = {
							staged: true,
							data_access_id: staged.dataAccessId,
							tables_created: staged.tablesCreated,
							total_rows: staged.totalRows,
							schema: staged.schema,
							message: `Large response staged. Use openneuro_query_data with data_access_id '${staged.dataAccessId}' to query the data, or openneuro_get_schema to inspect tables.`,
							_staging: staged._staging,
						};
						return {
							content: [{ type: "text", text: JSON.stringify(stagedPayload) }],
							structuredContent: stagedPayload,
						};
					} catch (stageErr) {
						console.error(`Auto-staging failed, returning inline: ${stageErr instanceof Error ? stageErr.message : String(stageErr)}`);
					}
				}

				return {
					content: [{
						type: "text",
						// Pretty print JSON for easier reading by humans, and parsable by LLMs.
						text: resultJson
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
interface Env {
	MCP_HOST?: string; // Standard MCP env var
	MCP_PORT?: string; // Standard MCP env var
	OPENNEURO_DATA_DO?: DurableObjectNamespace; // Durable Object for staging large responses
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

		// Streamable HTTP transport (MCP 2025-11-25 spec)
		if (url.pathname.startsWith("/mcp")) {
			return OpenNeuroMCP.serve("/mcp", { binding: "MCP_OBJECT" }).fetch(request, env, ctx);
		}

		// SSE transport (legacy, kept for backward compatibility)
		if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
			// @ts-ignore
			return OpenNeuroMCP.serveSSE("/sse", { binding: "MCP_OBJECT" }).fetch(request, env, ctx);
		}

		// Fallback for unhandled paths
		return new Response(
			`OpenNeuro MCP Server - Path not found.\nAvailable MCP paths:\n- /mcp (Streamable HTTP)\n- /sse (Server-Sent Events)`,
			{
				status: 404,
				headers: { "Content-Type": "text/plain" }
			}
		);
	},
};

// Export the Durable Object class (or main class for other environments)
export { OpenNeuroMCP as MyMCP };