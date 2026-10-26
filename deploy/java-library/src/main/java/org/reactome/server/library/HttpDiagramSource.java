package org.reactome.server.library;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The release's diagram files, fetched on demand from its download directory: the same static
 * {@code diagram/{stId}.json} files the site's browser loads (spec 015 research R10, amended 25 Oct 2026). One file
 * per converted pathway that has a diagram; the caller keeps it per release, so a file is kept only once it is
 * whole and is the pathway's: the converter would refuse anything else on every request until the next release.
 */
public class HttpDiagramSource implements SbmlFiles.DiagramSource {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final URI base;
    private final HttpClient client;
    private final Duration timeout;

    public HttpDiagramSource(URI base) {
        this(base, Duration.ofSeconds(60));
    }

    HttpDiagramSource(URI base, Duration timeout) {
        this.base = base;
        this.timeout = timeout;
        this.client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @Override
    public void fetch(String stId, int release, Path into) throws SbmlFiles.DiagramUnavailable {
        URI uri = base.resolve(release + "/diagram/" + stId + ".json");
        Path part = into.resolve(stId + ".json.part");
        try {
            HttpRequest request = HttpRequest.newBuilder(uri).GET().build();
            // The whole download within the timeout: a request's own timeout covers only the wait for the
            // headers, so a body that stalls would hold a conversion's place for good.
            CompletableFuture<HttpResponse<Path>> download = client.sendAsync(request,
                    HttpResponse.BodyHandlers.ofFile(part));
            HttpResponse<Path> response;
            try {
                response = download.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            } catch (TimeoutException e) {
                download.cancel(true);
                throw new SbmlFiles.DiagramUnavailable(uri + " did not arrive within " + timeout.toSeconds() + " s", e);
            } catch (ExecutionException e) {
                throw new SbmlFiles.DiagramUnavailable("Cannot fetch " + uri + ": " + e.getCause(), e.getCause());
            }
            if (response.statusCode() != 200) {
                throw new SbmlFiles.DiagramUnavailable(uri + " answered " + response.statusCode(), null);
            }
            if (!isTheDiagramOf(stId, part)) {
                throw new SbmlFiles.DiagramUnavailable(uri + " is not " + stId + "'s diagram", null);
            }
            Files.move(part, into.resolve(stId + ".json"), StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new SbmlFiles.DiagramUnavailable("Cannot fetch " + uri + ": " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new SbmlFiles.DiagramUnavailable("Interrupted fetching " + uri, e);
        } finally {
            try {
                Files.deleteIfExists(part);
            } catch (IOException ignored) {
                // A stray part file is overwritten by the next fetch
            }
        }
    }

    private static boolean isTheDiagramOf(String stId, Path file) {
        try {
            JsonNode diagram = JSON.readTree(file.toFile());
            return diagram != null && diagram.isObject() && stId.equals(diagram.path("stableId").asText());
        } catch (IOException e) {
            return false;
        }
    }
}
