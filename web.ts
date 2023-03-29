import { Application } from "./app.ts";

export const HtmlTemplate = `
<!DOCTYPE html>
<html>
  <head>
    <title>%title%</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/simpledotcss@2.2.0/simple.min.css" />
  </head>
  <body>
    %body%
  </body>
</html>
`;

export async function render(req: Request, app: Application) {
  const url = new URL(req.url);

  const rHtml = (s: string) =>
    new Response(s, { headers: { "content-type": "text/html" } });

  if (req.method === "GET" && url.pathname === "/") {
    const info = await app.repo.query({
      kinds: [0],
      authors: [app.nip11.pubkey],
    });
    const json = JSON.parse(info[0]?.content || "{}");
    const u = new URL(url);
    u.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    return rHtml(renderHome({
      name: app.nip11.name,
      adminName: json.name,
      url: u.href,
    }));
  }

  return new Response(null, { status: 404 });
}

function renderHome(params: Record<string, string>) {
  return HtmlTemplate.replace("%title%", "💜 Nostring 💜")
    .replace(
      "%body%",
      `
<header>
  <h1>${params.name || "nostring"}</h1>
  <p>${params.description || "This is a Nostr relay."}</p>
  <nav>
    <a href="https://github.com/xbol0/nostring" target="_blank">Github</a>
  </nav>
</header>
<main>
  <h2>About this relay</h2>
  <p>Relay URL: ${params.url}</p>
  <p>Relay admin: <a href="nostr:${params.adminNprofile}">@${params.adminName}</a></p>
</main>
      `,
    );
}
