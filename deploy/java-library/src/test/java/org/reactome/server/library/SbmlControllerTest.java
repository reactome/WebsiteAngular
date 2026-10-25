package org.reactome.server.library;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.ResponseEntity;

class SbmlControllerTest {

    @TempDir
    Path cache;

    private final SbmlFiles.Graph graph = new SbmlFiles.Graph() {
        @Override
        public int release() {
            return 97;
        }

        @Override
        public Optional<SbmlFiles.Event> event(String stId) {
            return stId.equals("R-HSA-1") ? Optional.of(new SbmlFiles.Event(true)) : Optional.empty();
        }
    };

    private SbmlController controller(SbmlFiles.DiagramSource diagrams, SbmlFiles.Converter converter) {
        return new SbmlController(new SbmlFiles(graph, converter, diagrams, cache), graph, new Properties());
    }

    private final SbmlFiles.Converter writes = (stId, rel, d, into) -> Files.writeString(into.resolve(stId + ".sbml"), "<sbml/>");
    private final SbmlFiles.DiagramSource fetches = (stId, rel, into) -> {
        try {
            Files.writeString(into.resolve(stId + ".json"), "{}");
        } catch (java.io.IOException e) {
            throw new SbmlFiles.DiagramUnavailable(e.getMessage(), e);
        }
    };

    @Test
    void answersTheFileAsSbml() throws Exception {
        ResponseEntity<?> answer = controller(fetches, writes).sbml("R-HSA-1");
        assertEquals(200, answer.getStatusCodeValue());
        assertEquals(SbmlController.SBML, answer.getHeaders().getContentType());
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
        SbmlFiles.DiagramSource failing = (stId, rel, into) -> {
            throw new SbmlFiles.DiagramUnavailable("answered 404", null);
        };
        ResponseEntity<?> answer = controller(failing, writes).sbml("R-HSA-1");
        assertEquals(503, answer.getStatusCodeValue());
        assertEquals(Map.of("error", "answered 404"), answer.getBody());
    }

    @Test
    void aConversionThatFailsIs500() throws Exception {
        SbmlFiles.Converter failing = (stId, rel, d, into) -> {
            throw new IllegalStateException("no reactions");
        };
        assertEquals(500, controller(fetches, failing).sbml("R-HSA-1").getStatusCodeValue());
    }
}
