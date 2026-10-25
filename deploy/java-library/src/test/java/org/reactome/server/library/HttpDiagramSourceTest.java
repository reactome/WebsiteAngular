package org.reactome.server.library;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class HttpDiagramSourceTest {

    @TempDir
    Path into;

    private HttpServer server;
    private final List<String> asked = new CopyOnWriteArrayList<>();

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            asked.add(path);
            byte[] body = "{\"stableId\":\"R-HSA-1\"}".getBytes(StandardCharsets.UTF_8);
            int status = path.equals("/files/97/diagram/R-HSA-1.json") ? 200 : 404;
            exchange.sendResponseHeaders(status, status == 200 ? body.length : -1);
            if (status == 200) {
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(body);
                }
            }
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private HttpDiagramSource source() {
        return new HttpDiagramSource(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/files/"));
    }

    @Test
    void writesTheReleasesFile() throws Exception {
        source().fetch("R-HSA-1", 97, into);
        assertEquals(List.of("/files/97/diagram/R-HSA-1.json"), asked);
        assertEquals("{\"stableId\":\"R-HSA-1\"}", Files.readString(into.resolve("R-HSA-1.json")));
    }

    @Test
    void aMissingFileIsUnavailableAndLeavesNothing() throws Exception {
        SbmlFiles.DiagramUnavailable e = assertThrows(SbmlFiles.DiagramUnavailable.class,
                () -> source().fetch("R-HSA-2", 97, into));
        assertTrue(e.getMessage().contains("answered 404"), e.getMessage());
        try (var left = Files.list(into)) {
            assertEquals(0, left.count());
        }
    }
}
