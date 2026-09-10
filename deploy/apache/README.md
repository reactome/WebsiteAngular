# Apache config for the beta host

`beta-bot-blocks.conf` blocks automated traffic to beta.reactome.org.

## Installing it

Use the script; it does the copy, wires the `Include` into both beta vhosts,
tests the config, reloads, and then checks that a bot is refused and a browser
is not:

```bash
sudo ~/install-beta-bot-blocks.sh            # install
sudo ~/install-beta-bot-blocks.sh --check    # verify, change nothing
sudo ~/install-beta-bot-blocks.sh --undo     # remove again
```

It is safe to run twice, backs up every file it edits, and if `apache2ctl
configtest` fails it restores the backups and reloads nothing -- so a bad rule
cannot take the vhost down. That last part is why the manual route below is not
the recommended one:

```bash
sudo cp deploy/apache/beta-bot-blocks.conf /etc/apache2/sites-common/
# then, inside each beta vhost, before </VirtualHost>:
#   Include /etc/apache2/sites-common/beta-bot-blocks.conf
sudo apache2ctl configtest && sudo systemctl reload apache2
```

## Checking it works

```bash
# should be 403
curl -s -o /dev/null -w '%{http_code}\n' -A 'Mozilla/5.0 (compatible; GPTBot/1.2)' https://beta.reactome.org/
# should be 200 -- this is the one to check after every edit
curl -s -o /dev/null -w '%{http_code}\n' -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36' https://beta.reactome.org/
```

## Why this host is stricter than production

Production wants to be indexed and so can only blacklist named crawlers. This
host does not: it is a development deployment with one user, and its Tomcat has
a 6 GB heap that fills within minutes when something walks the pathway URLs,
since each of those is a Neo4j query. The rules here therefore refuse anything
that identifies itself as automation, which is a far easier rule to keep correct
than a list of names that grows every month.

Do not copy rule 2 to production. It blocks Googlebot.

## The IP problem

Every request arrives from Cloudflare, so Apache sees Cloudflare's addresses
rather than clients'. Until `mod_remoteip` is configured (commented block at the
bottom of the conf), IP-based rules and the access log are both meaningless, and
only header matching works. Configuring it is worth doing regardless, so the
logs stop attributing every request to Cloudflare.

## What to check when the box is struggling

```bash
sudo tail -20000 /var/log/apache2/access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head
sudo tail -20000 /var/log/apache2/access.log | grep -oiE '"[^"]*(bot|crawl|spider|python)[^"]*"$' | sort | uniq -c | sort -rn | head
ss -ltn | grep -E ':80|:443'          # a full accept queue means workers are all blocked
ps -o etime=,rss= -p "$(pgrep -f catalina | head -1)"   # tomcat uptime and heap
```

Note that bot traffic is not the only way to exhaust that heap: a full e2e run
is ~52 page loads, each fanning out to many backend calls, several of them the
most expensive queries the content service has.

## /admin returns 403 on beta, and should

The TinaCMS admin is part of the build output (`dist/reactome/browser/admin/`),
so it is present on any host that serves the site. It is meant to be reachable
only when an editor runs the site on their own machine -- `npm run dev:serve`,
which starts `tinacms dev` alongside `ng serve` -- and never on a publicly
reachable host. beta.reactome.org therefore answers `/admin` with 403 while
localhost:4200 serves it normally. Confirmed intentional 2026-08-18.

The rule is not in this directory; it lives in the live Apache config, so
finding it needs sudo. If a future change makes `/admin` load on beta, that is a
regression to fix rather than a feature to keep.

## /chat goes to the chatbot container

`beta-chat-proxy.conf` routes `beta.reactome.org/chat/` to the React-to-Me
chatbot container on 127.0.0.1:8000, and redirects bare `/chat` to it. The
homepage's "AI Chatbot" shortcut is a plain `href`, not a `routerLink`: the
navigation has to leave the Angular app so Apache can claim the URL.

```sh
sudo ./install-beta-chat-proxy.sh            # install
sudo ./install-beta-chat-proxy.sh --check    # verify, change nothing
sudo ./install-beta-chat-proxy.sh --undo     # remove again
```

Two things about this one differ from `beta-bot-blocks.conf`, and both are
load-bearing:

- **The Include goes at the TOP of each vhost**, not the bottom. Apache matches
  `ProxyPass` in source order and these vhosts already proxy `/` to the Angular
  server on :4200, so an Include at the bottom never fires and `/chat` renders
  the Angular wildcard route instead.
- **`proxy_wstunnel` must be enabled.** Chainlit carries chat traffic over
  socket.io, which upgrades to a websocket; without the module the UI renders
  and then hangs with no replies.

Verify with `curl -sI https://beta.reactome.org/chat/` (200) and
`curl -sI https://beta.reactome.org/chat` (302 to `/chat/`).
