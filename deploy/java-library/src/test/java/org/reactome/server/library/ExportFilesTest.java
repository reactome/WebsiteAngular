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
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ExportFilesTest {

    @TempDir
    Path cache;

    private int release = 97;
    private final List<String> calls = Collections.synchronizedList(new ArrayList<>());
    private final AtomicInteger lookups = new AtomicInteger();

    /** A graph with a pathway that has a diagram, one that has none, and nothing else. */
    private final ExportFiles.Graph graph = new ExportFiles.Graph() {
        @Override
        public int release() {
            return release;
        }

        @Override
        public Optional<ExportFiles.Event> event(String stId) {
            lookups.incrementAndGet();
            if (stId.equals("R-HSA-1")) return Optional.of(new ExportFiles.Event(true));
            if (stId.equals("R-HSA-2")) return Optional.of(new ExportFiles.Event(false));
            return Optional.empty();
        }
    };

    private final ExportFiles.Converter converter = (stId, rel, diagrams, into) -> {
        calls.add("convert " + stId + " " + rel + " diagram=" + Files.exists(diagrams.resolve(stId + ".json")));
        Files.writeString(into.resolve(stId + ".sbml"), "<sbml release='" + rel + "'/>");
    };

    private final ExportFiles.DiagramSource diagrams = (stId, rel, into) -> {
        calls.add("fetch " + stId + " " + rel);
        try {
            Files.writeString(into.resolve(stId + ".json"), "{}");
        } catch (java.io.IOException e) {
            throw new ExportFiles.DiagramUnavailable(e.getMessage(), e);
        }
    };

    private final Semaphore cap = new Semaphore(2);

    private ExportFiles sbml(ExportFiles.Converter converter, ExportFiles.DiagramSource diagrams) {
        return new ExportFiles("sbml", ".sbml", graph, converter, diagrams, cache, cap);
    }

    /** BioPAX needs no diagram file: the export is made with none. */
    private final ExportFiles.Converter owl = (stId, rel, diagrams, into) -> {
        calls.add("biopax " + stId + " " + rel);
        Files.writeString(into.resolve(stId + ".owl"), "<rdf:RDF release='" + rel + "'/>");
    };

    private ExportFiles biopax(ExportFiles.Converter converter) {
        return new ExportFiles("biopax", ".owl", graph, converter, null, cache, cap);
    }

    @Test
    void anExportWithNoDiagramSourceNeverFetchesOne() throws Exception {
        ExportFiles files = biopax(owl);
        Path file = files.get("R-HSA-1").orElseThrow();
        assertEquals(cache.resolve("biopax/97/R-HSA-1.owl"), file);
        assertEquals(List.of("biopax R-HSA-1 97"), calls);
    }

    @Test
    void eachExportKeepsItsOwnFiles() throws Exception {
        ExportFiles sbml = sbml(converter, diagrams);
        ExportFiles biopax = biopax(owl);
        assertEquals("<sbml release='97'/>", Files.readString(sbml.get("R-HSA-2").orElseThrow()));
        assertEquals("<rdf:RDF release='97'/>", Files.readString(biopax.get("R-HSA-2").orElseThrow()));
        // A new release seen by one export leaves the other's files to it, and each then converts afresh
        release = 98;
        biopax.get("R-HSA-2");
        assertTrue(Files.exists(cache.resolve("sbml/97/R-HSA-2.sbml")));
        assertFalse(Files.exists(cache.resolve("biopax/97")));
    }

    @Test
    void theCapIsSharedByTheExports() throws Exception {
        CountDownLatch inside = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger at = new AtomicInteger();
        AtomicInteger most = new AtomicInteger();
        ExportFiles.Converter held = (stId, rel, d, into) -> {
            most.accumulateAndGet(at.incrementAndGet(), Math::max);
            inside.countDown();
            assertTrue(release.await(10, TimeUnit.SECONDS));
            at.decrementAndGet();
            Files.writeString(into.resolve(stId + (into.toString().contains("biopax") ? ".owl" : ".sbml")), "x");
        };
        ExportFiles sbml = sbml(held, diagrams);
        ExportFiles biopax = biopax(held);
        ExecutorService pool = Executors.newFixedThreadPool(3);
        try {
            Future<Optional<Path>> a = pool.submit(() -> sbml.get("R-HSA-2"));
            Future<Optional<Path>> b = pool.submit(() -> biopax.get("R-HSA-2"));
            assertTrue(inside.await(10, TimeUnit.SECONDS));
            Future<Optional<Path>> c = pool.submit(() -> biopax.get("R-HSA-1"));
            Thread.sleep(200); // c waits for a place: two conversions are running, one of each export
            assertEquals(2, at.get());
            release.countDown();
            a.get(10, TimeUnit.SECONDS);
            b.get(10, TimeUnit.SECONDS);
            c.get(10, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertEquals(2, most.get());
    }

    @Test
    void anIdNotInTheGraphIsEmpty() throws Exception {
        ExportFiles files = sbml(converter, diagrams);
        assertTrue(files.get("R-HSA-3").isEmpty());
        assertTrue(calls.isEmpty());
    }

    @Test
    void convertsOnceAndKeepsTheFile() throws Exception {
        ExportFiles files = sbml(converter, diagrams);
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
        ExportFiles files = sbml(converter, diagrams);
        files.get("R-HSA-1");
        files.get("R-HSA-2");
        assertEquals(List.of("fetch R-HSA-1 97", "convert R-HSA-1 97 diagram=true", "convert R-HSA-2 97 diagram=false"),
                calls);
    }

    @Test
    void aDiagramThatCannotBeHadIsNeverSbmlWithoutItsLayout() throws Exception {
        ExportFiles.DiagramSource failing = (stId, rel, into) -> {
            throw new ExportFiles.DiagramUnavailable("answered 503", null);
        };
        ExportFiles files = sbml(converter, failing);
        assertThrows(ExportFiles.DiagramUnavailable.class, () -> files.get("R-HSA-1"));
        assertTrue(calls.isEmpty());
        assertFalse(Files.exists(cache.resolve("sbml/97/R-HSA-1.sbml")));
    }

    @Test
    void aFailedConversionIsTriedAgain() throws Exception {
        AtomicInteger attempts = new AtomicInteger();
        ExportFiles.Converter once = (stId, rel, d, into) -> {
            if (attempts.incrementAndGet() == 1) throw new IllegalStateException("the first attempt fails");
            Files.writeString(into.resolve(stId + ".sbml"), "<sbml/>");
        };
        ExportFiles files = sbml(once, diagrams);
        assertThrows(IllegalStateException.class, () -> files.get("R-HSA-2"));
        assertEquals("<sbml/>", Files.readString(files.get("R-HSA-2").orElseThrow()));
        assertEquals(2, attempts.get());
    }

    @Test
    void workLeftByAStoppedServiceIsRemoved() throws Exception {
        Path stale = Files.createDirectories(cache.resolve("tmp/sbml/left-by-a-killed-run"));
        Files.writeString(stale.resolve("R-HSA-2.sbml"), "<sbml");
        Path others = Files.createDirectories(cache.resolve("tmp/biopax/another-export-running"));
        sbml(converter, diagrams);
        assertFalse(Files.exists(cache.resolve("tmp/sbml")));
        // Another export's work is its own to clear
        assertTrue(Files.exists(others));
    }

    @Test
    void aNewReleaseIsNeverAnsweredFromTheOldOnesFiles() throws Exception {
        ExportFiles files = sbml(converter, diagrams);
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
        ExportFiles.Converter slow = (stId, rel, d, into) -> {
            conversions.incrementAndGet();
            started.countDown();
            assertTrue(release.await(10, TimeUnit.SECONDS));
            Files.writeString(into.resolve(stId + ".sbml"), "<sbml/>");
        };
        ExportFiles files = sbml(slow, diagrams);
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
