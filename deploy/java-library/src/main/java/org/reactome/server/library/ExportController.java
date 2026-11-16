package org.reactome.server.library;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * The service's answers to node, over loopback. Node writes the public answer: its headers, its errors in the
 * service's envelope and its cache labels (spec 015 T065, T070). This writes only the body, or a status and a reason.
 */
@RestController
public class ExportController {

    private static final Logger logger = LoggerFactory.getLogger(ExportController.class);
    private static final Pattern ST_ID = Pattern.compile("R-[A-Z]{3}-\\d+");
    static final MediaType SBML = MediaType.parseMediaType("application/sbml+xml;charset=UTF-8");
    static final MediaType BIOPAX = MediaType.parseMediaType("application/rdf+xml;charset=UTF-8");

    private final ExportFiles sbml;
    private final ExportFiles biopax;
    private final ExportFiles.Graph graph;
    private final Properties pins;

    public ExportController(@Qualifier("sbmlFiles") ExportFiles sbml, @Qualifier("biopaxFiles") ExportFiles biopax,
                            ExportFiles.Graph graph, Properties pins) {
        this.sbml = sbml;
        this.biopax = biopax;
        this.graph = graph;
        this.pins = pins;
    }

    /** An event's SBML, by its stable id without a version: node resolves any other form first. */
    @GetMapping("/sbml/{stId}")
    public ResponseEntity<?> sbml(@PathVariable String stId) throws InterruptedException {
        return answer(sbml, SBML, stId);
    }

    /**
     * An event's BioPAX Level 3, by its stable id without a version. Node decides 404 and 400 first (T070); the
     * service's own 404 is a backstop.
     */
    @GetMapping("/biopax/{stId}")
    public ResponseEntity<?> biopax(@PathVariable String stId) throws InterruptedException {
        return answer(biopax, BIOPAX, stId);
    }

    private static ResponseEntity<?> answer(ExportFiles files, MediaType type, String stId) throws InterruptedException {
        if (!ST_ID.matcher(stId).matches()) return reason(HttpStatus.BAD_REQUEST, "Not a stable id: " + stId);
        try {
            Optional<Path> file = files.get(stId);
            if (file.isEmpty()) return reason(HttpStatus.NOT_FOUND, "No event " + stId + " in the graph");
            Resource body = new FileSystemResource(file.get());
            return ResponseEntity.ok().contentType(type).body(body);
        } catch (ExportFiles.DiagramUnavailable e) {
            logger.warn("{}: {}", stId, e.getMessage());
            return reason(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage());
        } catch (RuntimeException e) {
            logger.error(stId + " cannot be converted", e);
            return reason(HttpStatus.INTERNAL_SERVER_ERROR, stId + " cannot be converted: " + e.getMessage());
        }
    }

    /** The pinned commits and the graph's release; 503 when the graph cannot be read. */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> answer = new LinkedHashMap<>();
        Map<String, String> commits = new LinkedHashMap<>();
        pins.stringPropertyNames().stream().sorted().forEach(name -> commits.put(name, pins.getProperty(name)));
        answer.put("pins", commits);
        try {
            answer.put("release", graph.release());
            return ResponseEntity.ok(answer);
        } catch (RuntimeException e) {
            answer.put("error", "The graph cannot be read: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(answer);
        }
    }

    private static ResponseEntity<Map<String, String>> reason(HttpStatus status, String message) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", message));
    }
}
