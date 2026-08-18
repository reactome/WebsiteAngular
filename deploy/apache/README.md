# Apache config for the beta host

`beta-bot-blocks.conf` blocks automated traffic to beta.reactome.org.

## Installing it

```bash
sudo cp deploy/apache/beta-bot-blocks.conf /etc/apache2/sites-common/
# then, inside the beta vhost:
#   Include /etc/apache2/sites-common/beta-bot-blocks.conf
sudo apache2ctl configtest && sudo systemctl reload apache2
```

`configtest` before `reload` matters: a bad rewrite rule takes the vhost down,
and this host fronts the only deployment anyone is testing against.

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
