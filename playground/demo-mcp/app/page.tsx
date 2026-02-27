export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">{"{{MCP_NAME}}"}</h1>
      <p className="text-lg text-gray-600">MCP Server is running</p>
      <p className="text-sm text-gray-400 mt-2">
        Endpoint: <code className="bg-gray-100 px-2 py-1 rounded">/mcp</code>
      </p>
    </main>
  );
}
