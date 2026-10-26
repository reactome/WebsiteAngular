package org.reactome.server.library;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The service's settings, read at run time and never baked into the image (spec 010 T016).
 *
 * <p>The graph's credentials come from a file read literally, as content-node's graph.ts reads its own: KEY=VALUE per
 * line, the rest of the line after the first '=' taken as it is. These are generated secrets, and a shell sourcing the
 * file would cut one at a '#' or expand a '$'. The environment wins over the file, so a deployment can inject them
 * without one.
 */
public final class Settings {

    public final String graphUri;
    public final String user;
    public final String password;
    public final String database;
    /** Where the release's diagram files are, as {@code {base}/{release}/diagram/{stId}.json}. */
    public final URI diagramBase;
    /** The SBML files and the diagram files, kept per release. */
    public final Path cache;

    private Settings(String graphUri, String user, String password, String database, URI diagramBase, Path cache) {
        this.graphUri = graphUri;
        this.user = user;
        this.password = password;
        this.database = database;
        this.diagramBase = diagramBase;
        this.cache = cache;
    }

    /**
     * @throws IllegalStateException naming every setting that is missing
     */
    public static Settings read(Map<String, String> env) {
        Map<String, String> file = fromFile(env.get("LIBRARY_ENV_FILE"));
        Map<String, String> merged = new HashMap<>(file);
        env.forEach((key, value) -> {
            if (value != null && !value.isEmpty()) merged.put(key, value);
        });

        List<String> missing = new ArrayList<>();
        for (String key : new String[]{"NEO4J_USER", "NEO4J_PASSWORD", "DIAGRAM_BASE", "SBML_CACHE"}) {
            if (merged.getOrDefault(key, "").isEmpty()) missing.add(key);
        }
        if (!missing.isEmpty()) {
            throw new IllegalStateException("Missing settings: " + String.join(", ", missing)
                    + " (from the environment or the file named by LIBRARY_ENV_FILE)");
        }
        String base = merged.get("DIAGRAM_BASE");
        return new Settings(
                merged.getOrDefault("NEO4J_URI", "bolt://127.0.0.1:7687"),
                merged.get("NEO4J_USER"),
                merged.get("NEO4J_PASSWORD"),
                merged.getOrDefault("NEO4J_DATABASE", "graph.db"),
                URI.create(base.endsWith("/") ? base : base + "/"),
                Path.of(merged.get("SBML_CACHE")));
    }

    /** KEY=VALUE lines, read literally; a missing file is no settings, and the check above names what is missing. */
    static Map<String, String> fromFile(String name) {
        Map<String, String> found = new HashMap<>();
        if (name == null || name.isEmpty()) return found;
        List<String> lines;
        try {
            lines = Files.readAllLines(Path.of(name), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return found;
        }
        for (String line : lines) {
            int at = line.indexOf('=');
            if (at < 1 || line.stripLeading().startsWith("#")) continue;
            found.put(line.substring(0, at).trim(), line.substring(at + 1).trim());
        }
        return found;
    }
}
