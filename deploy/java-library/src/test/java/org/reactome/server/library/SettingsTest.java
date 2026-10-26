package org.reactome.server.library;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SettingsTest {

    @TempDir
    Path dir;

    @Test
    void readsTheFileLiterally() throws Exception {
        Path file = dir.resolve("graph.env");
        Files.writeString(file, "# a comment\nNEO4J_USER=reader\nNEO4J_PASSWORD= a#b$c=d \nnot a setting\n");
        Settings settings = Settings.read(Map.of("LIBRARY_ENV_FILE", file.toString(),
                "DIAGRAM_BASE", "https://files.example/", "SBML_CACHE", "/cache"));
        assertEquals("reader", settings.user);
        // Everything after the first '=', trimmed: a shell would have cut it at '#' and expanded '$c'
        assertEquals("a#b$c=d", settings.password);
        assertEquals("bolt://127.0.0.1:7687", settings.graphUri);
        assertEquals("graph.db", settings.database);
    }

    @Test
    void theEnvironmentWins() throws Exception {
        Path file = dir.resolve("graph.env");
        Files.writeString(file, "NEO4J_USER=fromfile\nNEO4J_PASSWORD=secret\n");
        Settings settings = Settings.read(Map.of("LIBRARY_ENV_FILE", file.toString(), "NEO4J_USER", "fromenv",
                "DIAGRAM_BASE", "https://files.example", "SBML_CACHE", "/cache"));
        assertEquals("fromenv", settings.user);
        assertEquals("https://files.example/", settings.diagramBase.toString());
    }

    @Test
    void namesEveryMissingSetting() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> Settings.read(Map.of("NEO4J_USER", "reader")));
        assertTrue(e.getMessage().contains("NEO4J_PASSWORD, DIAGRAM_BASE, SBML_CACHE"), e.getMessage());
    }

    @Test
    void aFileThatCannotBeReadIsNamed() {
        String name = dir.resolve("not-there.env").toString();
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> Settings.read(Map.of("LIBRARY_ENV_FILE", name)));
        assertTrue(e.getMessage().contains(name), e.getMessage());
    }
}
