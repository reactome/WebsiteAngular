# The site's nginx, with its configuration baked in.
#
# The configuration used to be bind-mounted out of the working tree, which made
# a working directory a deployment input: check out a branch and the routes
# inside the running container were that branch's, one reload away from live.
# That was not hypothetical -- a feature branch's /mcp route was found sitting
# in this container, inert only because nginx reads its configuration at start.
#
# Baked instead, which is what the other three services here already do
# (`render`, `content-node`, `mcp`). The running configuration is then a
# property of an image rather than of whatever happens to be checked out, and
# "which config is live" has an answer you can read off `docker image inspect`
# rather than infer.
#
# What is deliberately NOT baked: the certificates. Those are host secrets and
# stay as runtime mounts, so this image carries nothing that cannot be rebuilt
# from the repository.
FROM nginx:alpine

# Which deployment this is. dev on the box that must not be indexed, production
# on the one that must -- the blanket bot rule makes that choice expensive to
# get wrong, which is why it is an explicit build argument rather than a
# default someone inherits.
ARG NGINX_ENV=dev

COPY deploy/nginx/common /etc/nginx/common
COPY deploy/nginx/${NGINX_ENV}.conf /etc/nginx/conf.d/default.conf

# Not `RUN nginx -t`: the configuration references certificates that are mounted
# at run time, so a build-time test would fail on every host for the wrong
# reason. Validate the built image before deploying it, which reads the same
# way and actually exercises the mounts:
#
#     docker compose build nginx
#     docker compose run --rm nginx nginx -t
#     docker compose up -d nginx
