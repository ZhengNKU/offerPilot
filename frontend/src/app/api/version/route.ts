export async function GET() {
  return Response.json({
    version: process.env.NEXT_PUBLIC_PROJECT_VERSION || "V0.0.0",
    service: "frontend",
  });
}
