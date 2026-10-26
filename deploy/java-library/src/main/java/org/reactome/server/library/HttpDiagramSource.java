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

/**
 * The release's diagram files, fetched on demand from its download directory: the same static
 * {@code diagram/{stId}.json} files the site's browser loads (spec 015 research R10, amended 25 Oct 2026). One file
 * per converted pathway that has a diagram; the caller keeps it per release.
 */
public class HttpDiagramSource implements SbmlFiles.DiagramSource {

    private final URI base;
    private final HttpClient client;

    public HttpDiagramSource(URI base) {
        this.base = base;
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
            HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(60)).GET().build();
            HttpResponse<Path> response = client.send(request, HttpResponse.BodyHandlers.ofFile(part));
            if (response.statusCode() != 200) {
                throw new SbmlFiles.DiagramUnavailable(uri + " answered " + response.statusCode(), null);
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
}
