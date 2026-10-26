package org.reactome.server.library;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Semaphore;
import java.util.stream.Stream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The SBML files, kept on disk per release as ContentService keeps its exports.
 *
 * <p>The release is the graph's, read for every request, so a graph moved to a new release is never answered from the
 * old one's files, and the old release's files are removed when it is first seen. One id is converted once at a time:
 * a second request for it waits for the first. Node's share of 2 is the limit on conversions (spec 015 T065); the cap
 * here is a backstop.
 *
 * <p>Removing files is best effort: a release can change while a conversion of the old one is still writing, and that
 * must not fail the new release's request. What is left behind goes when the next release is first seen.
 */
public class SbmlFiles {

    /** What the service needs from the graph. */
    public interface Graph {
        int release();

        /** The event, or empty when the graph has no event with that stable id. */
        Optional<Event> event(String stId);
    }

    /** An event, as far as the diagram files are concerned. */
    public static final class Event {
        /** A pathway the graph says has a diagram of its own: its layout needs the diagram file. */
        public final boolean hasDiagram;

        public Event(boolean hasDiagram) {
            this.hasDiagram = hasDiagram;
        }
    }

    /** sbml-exporter's library, writing {@code {stId}.sbml} into a folder. */
    public interface Converter {
        void convert(String stId, int release, Path diagrams, Path into) throws Exception;
    }

    /** Where the diagram files come from. */
    public interface DiagramSource {
        /**
         * Writes {@code {stId}.json} of the release into the folder.
         *
         * @throws DiagramUnavailable when it cannot
         */
        void fetch(String stId, int release, Path into) throws DiagramUnavailable;
    }

    /** A diagram file that could not be had: the answer is a 503, never SBML without its layout. */
    public static class DiagramUnavailable extends Exception {
        public DiagramUnavailable(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private static final Logger logger = LoggerFactory.getLogger(SbmlFiles.class);

    private final Graph graph;
    private final Converter converter;
    private final DiagramSource diagrams;
    private final Path cache;
    private final Semaphore conversions = new Semaphore(2);
    private final Map<String, CompletableFuture<Path>> running = new ConcurrentHashMap<>();
    private volatile int seen = -1;

    public SbmlFiles(Graph graph, Converter converter, DiagramSource diagrams, Path cache) {
        this.graph = graph;
        this.converter = converter;
        this.diagrams = diagrams;
        this.cache = cache;
        // Work in progress when the service last stopped, which nothing will finish
        delete(cache.resolve("tmp"));
    }

    /**
     * The event's SBML file, or empty when the graph has no such event.
     *
     * @throws DiagramUnavailable when its diagram file cannot be had
     */
    public Optional<Path> get(String stId) throws DiagramUnavailable, InterruptedException {
        int release = graph.release();
        forgetOtherReleases(release);
        Path file = cache.resolve("sbml").resolve(String.valueOf(release)).resolve(stId + ".sbml");
        if (Files.isRegularFile(file)) return Optional.of(file);

        Optional<Event> event = graph.event(stId);
        if (event.isEmpty()) return Optional.empty();

        CompletableFuture<Path> mine = new CompletableFuture<>();
        String key = release + "/" + stId;
        CompletableFuture<Path> theirs = running.putIfAbsent(key, mine);
        if (theirs != null) return Optional.of(await(theirs));
        try {
            mine.complete(convert(stId, release, event.get(), file));
        } catch (Throwable t) {
            mine.completeExceptionally(t);
        } finally {
            running.remove(key, mine);
        }
        return Optional.of(await(mine));
    }

    private Path convert(String stId, int release, Event event, Path file) throws Exception {
        if (Files.isRegularFile(file)) return file;
        conversions.acquire();
        try {
            Path diagramFolder = Files.createDirectories(cache.resolve("diagram").resolve(String.valueOf(release)));
            if (event.hasDiagram && !Files.isRegularFile(diagramFolder.resolve(stId + ".json"))) {
                diagrams.fetch(stId, release, diagramFolder);
            }
            Path work = Files.createDirectories(cache.resolve("tmp").resolve(UUID.randomUUID().toString()));
            try {
                converter.convert(stId, release, diagramFolder, work);
                Path written = work.resolve(stId + ".sbml");
                if (!Files.isRegularFile(written)) throw new IllegalStateException("The converter wrote no " + written);
                Files.createDirectories(file.getParent());
                return Files.move(written, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } finally {
                delete(work);
            }
        } finally {
            conversions.release();
        }
    }

    private static Path await(CompletableFuture<Path> future) throws DiagramUnavailable, InterruptedException {
        try {
            return future.get();
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof DiagramUnavailable) throw (DiagramUnavailable) cause;
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw new IllegalStateException(cause.getMessage(), cause);
        }
    }

    /** Removes every other release's files the first time a release is seen. */
    private void forgetOtherReleases(int release) {
        if (seen == release) return;
        synchronized (this) {
            if (seen == release) return;
            for (String kind : new String[]{"sbml", "diagram"}) {
                Path folder = cache.resolve(kind);
                if (!Files.isDirectory(folder)) continue;
                try (DirectoryStream<Path> releases = Files.newDirectoryStream(folder)) {
                    for (Path other : releases) {
                        if (!other.getFileName().toString().equals(String.valueOf(release))) delete(other);
                    }
                } catch (IOException e) {
                    logger.warn("Cannot list {}: {}", folder, e.toString());
                }
            }
            seen = release;
        }
    }

    private static void delete(Path path) {
        if (!Files.exists(path)) return;
        try (Stream<Path> all = Files.walk(path)) {
            all.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.delete(p);
                } catch (IOException e) {
                    logger.warn("Cannot remove {}: {}", p, e.toString());
                }
            });
        } catch (IOException | UncheckedIOException e) {
            logger.warn("Cannot remove {}: {}", path, e.toString());
        }
    }
}
