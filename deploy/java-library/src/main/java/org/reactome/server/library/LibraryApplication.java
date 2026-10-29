package org.reactome.server.library;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.Semaphore;

import org.reactome.server.graph.config.GraphCoreNeo4jConfig;
import org.reactome.server.graph.domain.model.Event;
import org.reactome.server.graph.domain.model.Pathway;
import org.reactome.server.graph.service.AdvancedDatabaseObjectService;
import org.reactome.server.graph.service.DatabaseObjectService;
import org.reactome.server.graph.service.GeneralService;
import org.reactome.server.tools.WriteBioPAX3;
import org.reactome.server.tools.sbml.converter.SbmlConverter;
import org.reactome.server.tools.sbml.layout.DiagramFiles;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

/**
 * Spec 010's library service, started in this repository with SBML (spec 015 T063) and BioPAX Level 3 (T069) as its
 * operations. Node answers the public URLs and calls this over loopback; this writes only the body.
 */
@SpringBootApplication
@Import(GraphCoreNeo4jConfig.class)
public class LibraryApplication {

    public static void main(String[] args) {
        Settings settings = Settings.read(System.getenv());
        // graph-core reads its connection from Spring's properties, as ReactomeGraphCore sets them
        System.setProperty("spring.neo4j.uri", settings.graphUri);
        System.setProperty("spring.neo4j.authentication.username", settings.user);
        System.setProperty("spring.neo4j.authentication.password", settings.password);
        System.setProperty("spring.data.neo4j.database", settings.database);
        SpringApplication application = new SpringApplication(LibraryApplication.class);
        application.addInitializers(context -> context.getBeanFactory().registerSingleton("settings", settings));
        application.run(args);
    }

    @Bean
    public ExportFiles.Graph graph(DatabaseObjectService ds, GeneralService general) {
        return new ExportFiles.Graph() {
            @Override
            public int release() {
                return general.getDBInfo().getVersion();
            }

            @Override
            public Optional<ExportFiles.Event> event(String stId) {
                Object found = ds.findById(stId);
                if (!(found instanceof Event)) return Optional.empty();
                boolean hasDiagram = found instanceof Pathway && Boolean.TRUE.equals(((Pathway) found).getHasDiagram());
                return Optional.of(new ExportFiles.Event(hasDiagram));
            }
        };
    }

    /** The conversions at once, across every export: two, within the heap (spec 015 T069). */
    @Bean
    public Semaphore conversions() {
        return new Semaphore(2);
    }

    @Bean
    public ExportFiles sbmlFiles(Settings settings, ExportFiles.Graph graph, DatabaseObjectService ds,
                                 AdvancedDatabaseObjectService ads, Semaphore conversions) {
        ExportFiles.Converter converter = (stId, release, diagrams, into) -> {
            Event event = ds.findById(stId);
            SbmlConverter sbml = new SbmlConverter(event, release, ds, ads, new DiagramFiles(diagrams, release, release));
            sbml.convert();
            sbml.writeToFile(into.toString());
        };
        return new ExportFiles("sbml", ".sbml", graph, converter, new HttpDiagramSource(settings.diagramBase),
                settings.cache, conversions);
    }

    /** BioPAX3Exporter's library: one event with all it holds, with the release's per-event xml:base. */
    @Bean
    public ExportFiles biopaxFiles(Settings settings, ExportFiles.Graph graph, DatabaseObjectService ds,
                                   Semaphore conversions) {
        ExportFiles.Converter converter = (stId, release, diagrams, into) -> {
            Event event = ds.findById(stId);
            WriteBioPAX3 biopax = new WriteBioPAX3(event, release);
            biopax.createModel();
            biopax.toFile(new File(into.toFile(), stId + ".owl"));
        };
        return new ExportFiles("biopax", ".owl", graph, converter, null, settings.cache, conversions);
    }

    /** The pinned commits the image was built from, written by the Dockerfile (deploy/java/PINS.md). */
    @Bean
    public Properties pins() throws IOException {
        Properties pins = new Properties();
        try (InputStream in = LibraryApplication.class.getResourceAsStream("/pins.properties")) {
            if (in != null) pins.load(in);
        }
        return pins;
    }
}
