package org.reactome.server.library;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SbmlFilesTest {

    @TempDir
    Path cache;

    private int release = 97;
    private final List<String> calls = Collections.synchronizedList(new ArrayList<>());
    private final AtomicInteger lookups = new AtomicInteger();

    /** A graph with a pathway that has a diagram, one that has none, and nothing else. */
    private final SbmlFiles.Graph graph = new SbmlFiles.Graph() {
        @Override
        public int release() {
            return release;
        }

        @Override
        public Optional<SbmlFiles.Event> event(String stId) {
            lookups.incrementAndGet();
            if (stId.equals("R-HSA-1")) return Optional.of(new SbmlFiles.Event(true));
            if (stId.equals("R-HSA-2")) return Optional.of(new SbmlFiles.Event(false));
            return Optional.empty();
        }
    };

    private final SbmlFiles.Converter converter = (stId, rel, diagrams, into) -> {
        calls.add("convert " + stId + " " + rel + " diagram=" + Files.exists(diagrams.resolve(stId + ".json")));
        Files.writeString(into.resolve(stId + ".sbml"), "<sbml release='" + rel + "'/>");
    };

    private final SbmlFiles.DiagramSource diagrams = (stId, rel, into) -> {
        calls.add("fetch " + stId + " " + rel);
        try {
            Files.writeString(into.resolve(stId + ".json"), "{}");
        } catch (java.io.IOException e) {
            throw new SbmlFiles.DiagramUnavailable(e.getMessage(), e);
        }
    };

    @Test
    void anIdNotInTheGraphIsEmpty() throws Exception {
        SbmlFiles files = new SbmlFiles(graph, converter, diagrams, cache);
        assertTrue(files.get("R-HSA-3").isEmpty());
        assertTrue(calls.isEmpty());
    }

    @Test
    void convertsOnceAndKeepsTheFile() throws Exception {
        SbmlFiles files = new SbmlFiles(graph, converter, diagrams, cache);
        Path first = files.get("R-HSA-2").orElseThrow();
        Path second = files.get("R-HSA-2").orElseThrow();
        assertEquals(first, second);
        assertEquals(cache.resolve("sbml/97/R-HSA-2.sbml"), first);
        assertEquals(List.of("convert R-HSA-2 97 diagram=false"), calls);
        // A kept file is answered without asking the graph about the event again
        assertEquals(1, lookups.get());
    }

    @Test
    void fetchesTheDiagramOfAPathwayThatHasOne() throws Exception {
        SbmlFiles files = new SbmlFiles(graph, converter, diagrams, cache);
        files.get("R-HSA-1");
        files.get("R-HSA-2");
        assertEquals(List.of("fetch R-HSA-1 97", "convert R-HSA-1 97 diagram=true", "convert R-HSA-2 97 diagram=false"),
                calls);
    }

    @Test
    void aDiagramThatCannotBeHadIsNeverSbmlWithoutItsLayout() throws Exception {
        SbmlFiles.DiagramSource failing = (stId, rel, into) -> {
            throw new SbmlFiles.DiagramUnavailable("answered 503", null);
        };
        SbmlFiles files = new SbmlFiles(graph, converter, failing, cache);
        assertThrows(SbmlFiles.DiagramUnavailable.class, () -> files.get("R-HSA-1"));
        assertTrue(calls.isEmpty());
        assertFalse(Files.exists(cache.resolve("sbml/97/R-HSA-1.sbml")));
    }

    @Test
    void aFailedConversionIsTriedAgain() throws Exception {
        AtomicInteger attempts = new AtomicInteger();
        SbmlFiles.Converter once = (stId, rel, d, into) -> {
            if (attempts.incrementAndGet() == 1) throw new IllegalStateException("the first attempt fails");
            Files.writeString(into.resolve(stId + ".sbml"), "<sbml/>");
        };
        SbmlFiles files = new SbmlFiles(graph, once, diagrams, cache);
        assertThrows(IllegalStateException.class, () -> files.get("R-HSA-2"));
        assertEquals("<sbml/>", Files.readString(files.get("R-HSA-2").orElseThrow()));
        assertEquals(2, attempts.get());
    }

    @Test
    void workLeftByAStoppedServiceIsRemoved() throws Exception {
        Path stale = Files.createDirectories(cache.resolve("tmp/left-by-a-killed-run"));
        Files.writeString(stale.resolve("R-HSA-2.sbml"), "<sbml");
        new SbmlFiles(graph, converter, diagrams, cache);
        assertFalse(Files.exists(cache.resolve("tmp")));
    }

    @Test
    void aNewReleaseIsNeverAnsweredFromTheOldOnesFiles() throws Exception {
        SbmlFiles files = new SbmlFiles(graph, converter, diagrams, cache);
        files.get("R-HSA-1");
        release = 98;
        Path file = files.get("R-HSA-1").orElseThrow();
        assertEquals("<sbml release='98'/>", Files.readString(file));
        assertFalse(Files.exists(cache.resolve("sbml/97")));
        assertFalse(Files.exists(cache.resolve("diagram/97")));
        assertEquals(List.of("fetch R-HSA-1 97", "convert R-HSA-1 97 diagram=true",
                "fetch R-HSA-1 98", "convert R-HSA-1 98 diagram=true"), calls);
    }

    @Test
    void oneIdIsConvertedOnceAtATime() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger conversions = new AtomicInteger();
        SbmlFiles.Converter slow = (stId, rel, d, into) -> {
            conversions.incrementAndGet();
            started.countDown();
            assertTrue(release.await(10, TimeUnit.SECONDS));
            Files.writeString(into.resolve(stId + ".sbml"), "<sbml/>");
        };
        SbmlFiles files = new SbmlFiles(graph, slow, diagrams, cache);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Optional<Path>> a = pool.submit(() -> files.get("R-HSA-2"));
            assertTrue(started.await(10, TimeUnit.SECONDS));
            Future<Optional<Path>> b = pool.submit(() -> files.get("R-HSA-2"));
            Thread.sleep(200); // b is waiting on a's conversion, not running its own
            release.countDown();
            assertEquals(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, conversions.get());
    }
}
