package org.reactome.server.library;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.Semaphore;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.ResponseEntity;

class ExportControllerTest {

    @TempDir
    Path cache;

    private final ExportFiles.Graph graph = new ExportFiles.Graph() {
        @Override
        public int release() {
            return 97;
        }

        @Override
        public Optional<ExportFiles.Event> event(String stId) {
            return stId.equals("R-HSA-1") ? Optional.of(new ExportFiles.Event(true)) : Optional.empty();
        }
    };

    private final ExportFiles.Converter owl = (stId, rel, d, into) -> Files.writeString(into.resolve(stId + ".owl"), "<rdf:RDF/>");

    private ExportController controller(ExportFiles.DiagramSource diagrams, ExportFiles.Converter converter) {
        return controller(diagrams, converter, owl);
    }

    private ExportController controller(ExportFiles.DiagramSource diagrams, ExportFiles.Converter converter,
                                        ExportFiles.Converter biopax) {
        Semaphore cap = new Semaphore(2);
        return new ExportController(new ExportFiles("sbml", ".sbml", graph, converter, diagrams, cache, cap),
                new ExportFiles("biopax", ".owl", graph, biopax, null, cache, cap), graph, new Properties());
    }

    private final ExportFiles.Converter writes = (stId, rel, d, into) -> Files.writeString(into.resolve(stId + ".sbml"), "<sbml/>");
    private final ExportFiles.DiagramSource fetches = (stId, rel, into) -> {
        try {
            Files.writeString(into.resolve(stId + ".json"), "{}");
        } catch (java.io.IOException e) {
            throw new ExportFiles.DiagramUnavailable(e.getMessage(), e);
        }
    };

    @Test
    void answersTheFileAsSbml() throws Exception {
        ResponseEntity<?> answer = controller(fetches, writes).sbml("R-HSA-1");
        assertEquals(200, answer.getStatusCodeValue());
        assertEquals(ExportController.SBML, answer.getHeaders().getContentType());
    }

    @Test
    void anIdNotInTheGraphIs404() throws Exception {
        assertEquals(404, controller(fetches, writes).sbml("R-HSA-9").getStatusCodeValue());
    }

    @Test
    void anythingButAStableIdIs400() throws Exception {
        for (String id : new String[]{"R-HSA-1.2", "123", "../R-HSA-1", "r-hsa-1"}) {
            assertEquals(400, controller(fetches, writes).sbml(id).getStatusCodeValue(), id);
        }
    }

    @Test
    void aDiagramThatCannotBeHadIs503() throws Exception {
        ExportFiles.DiagramSource failing = (stId, rel, into) -> {
            throw new ExportFiles.DiagramUnavailable("answered 404", null);
        };
        ResponseEntity<?> answer = controller(failing, writes).sbml("R-HSA-1");
        assertEquals(503, answer.getStatusCodeValue());
        assertEquals(Map.of("error", "answered 404"), answer.getBody());
    }

    @Test
    void aConversionThatFailsIs500() throws Exception {
        ExportFiles.Converter failing = (stId, rel, d, into) -> {
            throw new IllegalStateException("no reactions");
        };
        assertEquals(500, controller(fetches, failing).sbml("R-HSA-1").getStatusCodeValue());
    }

    @Test
    void answersBiopaxAsRdf() throws Exception {
        ResponseEntity<?> answer = controller(fetches, writes).biopax("R-HSA-1");
        assertEquals(200, answer.getStatusCodeValue());
        assertEquals(ExportController.BIOPAX, answer.getHeaders().getContentType());
        assertEquals("R-HSA-1.owl", ((org.springframework.core.io.Resource) answer.getBody()).getFilename());
    }

    @Test
    void biopaxNeedsNoDiagram() throws Exception {
        ExportFiles.DiagramSource failing = (stId, rel, into) -> {
            throw new ExportFiles.DiagramUnavailable("answered 404", null);
        };
        assertEquals(200, controller(failing, writes).biopax("R-HSA-1").getStatusCodeValue());
    }

    @Test
    void biopaxAnswersTheSameErrors() throws Exception {
        assertEquals(404, controller(fetches, writes).biopax("R-HSA-9").getStatusCodeValue());
        assertEquals(400, controller(fetches, writes).biopax("R-HSA-1.2").getStatusCodeValue());
        ExportFiles.Converter failing = (stId, rel, d, into) -> {
            throw new IllegalStateException("no model");
        };
        assertEquals(500, controller(fetches, writes, failing).biopax("R-HSA-1").getStatusCodeValue());
    }
}
