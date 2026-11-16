# Spec 010's library service, started here with SBML (spec 015 T063) and
# BioPAX Level 3 (T069): sbml-exporter's and BioPAX3Exporter's libraries behind
# loopback endpoints, which node calls.
#
# Every Reactome library is built from the commit deploy/java/PINS.md records,
# never taken from a published snapshot: a snapshot can be republished under the
# same version, and the shared parent POM already was once. When a library is
# published at a fixed version, its build goes and the pom names it.
#
# Built only on the beta host and in CI, and never pushed to a registry: the
# libraries have no licence yet (spec 015 research R10).

FROM maven:3.9.6-eclipse-temurin-17 AS libraries

# deploy/java/PINS.md, row for row. pins.spec.ts checks the two agree.
ARG REACTOME_PARENT_COMMIT=d93ad5a417724647f04810b476f6c2705a0e3aec
ARG GRAPH_CORE_COMMIT=62aef35d7a89403b8a8800dc004d8de62f847aee
ARG SBML_EXPORTER_COMMIT=f7b10342258d1aacd4f77f44bd928a29b516025e
ARG BIOPAX3_EXPORTER_COMMIT=64c716a7f37081b42c1cf7b30bdebbf55ff580e2

WORKDIR /build

# Each repository's tree at its commit, from GitHub's archive of it: no git, and
# nothing but that commit.
RUN set -eu; \
    fetch() { \
      mkdir "$1" && curl -fsSL "https://codeload.github.com/reactome/$1/tar.gz/$2" \
        | tar -xz -C "$1" --strip-components=1; \
    }; \
    fetch reactome-parent "$REACTOME_PARENT_COMMIT"; \
    fetch graph-core "$GRAPH_CORE_COMMIT"; \
    fetch sbml-exporter "$SBML_EXPORTER_COMMIT"; \
    fetch BioPAX3Exporter "$BIOPAX3_EXPORTER_COMMIT"

# -nsu: a snapshot installed here is never replaced by a repository's.
RUN set -eu; \
    cd /build/reactome-parent/boms && mvn -B -q -nsu install -N; \
    cd /build/reactome-parent/boms/reactome-bom && mvn -B -q -nsu install; \
    cd /build/reactome-parent/parents/reactome-parent && mvn -B -q -nsu install; \
    cd /build/graph-core && mvn -B -q -nsu install -DskipTests; \
    cd /build/sbml-exporter && mvn -B -q -nsu install -pl lib -am -DskipTests; \
    cd /build/BioPAX3Exporter && mvn -B -q -nsu install -pl lib -am -DskipTests

FROM libraries AS service

ARG REACTOME_PARENT_COMMIT=d93ad5a417724647f04810b476f6c2705a0e3aec
ARG GRAPH_CORE_COMMIT=62aef35d7a89403b8a8800dc004d8de62f847aee
ARG SBML_EXPORTER_COMMIT=f7b10342258d1aacd4f77f44bd928a29b516025e
ARG BIOPAX3_EXPORTER_COMMIT=64c716a7f37081b42c1cf7b30bdebbf55ff580e2

WORKDIR /service
COPY deploy/java-library/pom.xml ./
COPY deploy/java-library/src ./src
# The commits the health endpoint reports.
RUN printf 'reactome-parent=%s\ngraph-core=%s\nsbml-exporter=%s\nBioPAX3Exporter=%s\n' \
      "$REACTOME_PARENT_COMMIT" "$GRAPH_CORE_COMMIT" "$SBML_EXPORTER_COMMIT" "$BIOPAX3_EXPORTER_COMMIT" \
      > src/main/resources/pins.properties
RUN mvn -B -q -nsu package

# The jar must carry the libraries built above, not a repository's copies of
# their versions: compare their bytes. And the BioPAX library's Kotlin and
# Paxtools at its own versions, alone: Spring Boot's dependency management
# would give Kotlin's standard library as 1.6.21 (the pom holds it).
RUN set -eu; \
    mkdir /check && cd /check && jar -xf /service/target/java-library.jar BOOT-INF/lib; \
    cmp BOOT-INF/lib/graph-core-3.0.0-SNAPSHOT.jar /build/graph-core/target/graph-core.jar; \
    cmp BOOT-INF/lib/sbml-exporter-lib-3.0.0-SNAPSHOT.jar /build/sbml-exporter/lib/target/sbml-exporter-lib-3.0.0-SNAPSHOT.jar; \
    cmp BOOT-INF/lib/biopax3-exporter-lib-0.0.1-SNAPSHOT.jar /build/BioPAX3Exporter/lib/target/biopax3-exporter-lib-0.0.1-SNAPSHOT.jar; \
    kotlin=$(sed -n 's|.*<kotlin.version>\(.*\)</kotlin.version>.*|\1|p' /build/BioPAX3Exporter/pom.xml); \
    paxtools=$(sed -n 's|.*<paxtools.version>\(.*\)</paxtools.version>.*|\1|p' /build/BioPAX3Exporter/pom.xml); \
    [ "$(ls BOOT-INF/lib | grep '^kotlin-stdlib-[0-9]')" = "kotlin-stdlib-$kotlin.jar" ]; \
    [ "$(ls BOOT-INF/lib | grep '^paxtools-core-')" = "paxtools-core-$paxtools.jar" ]

FROM eclipse-temurin:17-jre

# SBML's dates are written in the default zone and locale, as sbml-exporter's
# runs are: UTC, which Tomcat's is, and en_US.
ENV TZ=UTC \
    JAVA_TOOL_OPTIONS="-Duser.timezone=UTC -Duser.language=en -Duser.country=US -Xmx1g"

# /cache is writable by any user, as /tmp is: compose runs the service as the
# owner of the graph's credentials file (0600), not as `library`, and a named
# volume starts with the image's ownership and mode for the folder it mounts.
RUN useradd --system --uid 10001 --create-home library \
    && mkdir -p /cache && chown library /cache && chmod 1777 /cache
COPY --from=service /service/target/java-library.jar /app/java-library.jar

USER library
EXPOSE 4360
ENTRYPOINT ["java", "-jar", "/app/java-library.jar"]
