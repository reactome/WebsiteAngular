package org.reactome.server.library;

import java.io.IOException;
import java.io.InputStream;
import java.util.Optional;
import java.util.Properties;

import org.reactome.server.graph.config.GraphCoreNeo4jConfig;
import org.reactome.server.graph.domain.model.Event;
import org.reactome.server.graph.domain.model.Pathway;
import org.reactome.server.graph.service.AdvancedDatabaseObjectService;
import org.reactome.server.graph.service.DatabaseObjectService;
import org.reactome.server.graph.service.GeneralService;
import org.reactome.server.tools.sbml.converter.SbmlConverter;
import org.reactome.server.tools.sbml.layout.DiagramFiles;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

/**
 * Spec 010's library service, started in this repository with SBML as its only operation (spec 015 T063). Node
 * answers the public URLs and calls this over loopback; this writes only the body.
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
    public SbmlFiles.Graph graph(DatabaseObjectService ds, GeneralService general) {
        return new SbmlFiles.Graph() {
            @Override
            public int release() {
                return general.getDBInfo().getVersion();
            }

            @Override
            public Optional<SbmlFiles.Event> event(String stId) {
                Object found = ds.findById(stId);
                if (!(found instanceof Event)) return Optional.empty();
                boolean hasDiagram = found instanceof Pathway && Boolean.TRUE.equals(((Pathway) found).getHasDiagram());
                return Optional.of(new SbmlFiles.Event(hasDiagram));
            }
        };
    }

    @Bean
    public SbmlFiles.Converter converter(DatabaseObjectService ds, AdvancedDatabaseObjectService ads) {
        return (stId, release, diagrams, into) -> {
            Event event = ds.findById(stId);
            SbmlConverter converter = new SbmlConverter(event, release, ds, ads, new DiagramFiles(diagrams, release, release));
            converter.convert();
            converter.writeToFile(into.toString());
        };
    }

    @Bean
    public SbmlFiles sbmlFiles(Settings settings, SbmlFiles.Graph graph, SbmlFiles.Converter converter) {
        return new SbmlFiles(graph, converter, new HttpDiagramSource(settings.diagramBase), settings.cache);
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
