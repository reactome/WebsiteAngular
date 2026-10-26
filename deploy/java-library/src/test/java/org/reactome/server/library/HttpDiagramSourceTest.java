package org.reactome.server.library;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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
    private final CountDownLatch done = new CountDownLatch(1);

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            asked.add(path);
            String text = switch (path) {
                case "/files/97/diagram/R-HSA-1.json" -> "{\"stableId\":\"R-HSA-1\"}";
                // A page answered in place of the file, as an error page or a sign-in page can be
                case "/files/97/diagram/R-HSA-3.json" -> "<html>Please wait</html>";
                case "/files/97/diagram/R-HSA-4.json" -> "{\"stableId\":\"R-HSA-1\"}";
                default -> null;
            };
            if (path.equals("/files/97/diagram/R-HSA-5.json")) {
                // The headers and a little of the body, then nothing
                exchange.sendResponseHeaders(200, 100);
                OutputStream out = exchange.getResponseBody();
                out.write("{\"stableId\"".getBytes(StandardCharsets.UTF_8));
                out.flush();
                try {
                    done.await(30, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                exchange.close();
                return;
            }
            byte[] body = text == null ? new byte[0] : text.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(text == null ? 404 : 200, text == null ? -1 : body.length);
            if (text != null) {
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(body);
                }
            }
            exchange.close();
        });
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
    }

    @AfterEach
    void stop() {
        done.countDown();
        server.stop(0);
    }

    private HttpDiagramSource source() {
        return new HttpDiagramSource(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/files/"),
                Duration.ofSeconds(2));
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

    @Test
    void aPageInPlaceOfTheFileIsUnavailableAndNotKept() throws Exception {
        SbmlFiles.DiagramUnavailable e = assertThrows(SbmlFiles.DiagramUnavailable.class,
                () -> source().fetch("R-HSA-3", 97, into));
        assertTrue(e.getMessage().contains("not R-HSA-3's diagram"), e.getMessage());
        try (var left = Files.list(into)) {
            assertEquals(0, left.count());
        }
    }

    @Test
    void anotherPathwaysDiagramIsUnavailableAndNotKept() throws Exception {
        SbmlFiles.DiagramUnavailable e = assertThrows(SbmlFiles.DiagramUnavailable.class,
                () -> source().fetch("R-HSA-4", 97, into));
        assertTrue(e.getMessage().contains("not R-HSA-4's diagram"), e.getMessage());
        try (var left = Files.list(into)) {
            assertEquals(0, left.count());
        }
    }

    @Test
    void aBodyThatStallsIsUnavailableWithinTheTimeout() throws Exception {
        // The request's own timeout covers only the wait for the headers
        assertTimeoutPreemptively(Duration.ofSeconds(15),
                () -> assertThrows(SbmlFiles.DiagramUnavailable.class, () -> source().fetch("R-HSA-5", 97, into)));
        try (var left = Files.list(into)) {
            assertEquals(0, left.count());
        }
    }
}
