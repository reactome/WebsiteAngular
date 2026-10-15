import com.fasterxml.jackson.annotation.JsonIdentityInfo;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.ObjectIdGenerators;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.ser.BeanPropertyWriter;
import com.fasterxml.jackson.databind.ser.PropertyWriter;
import com.fasterxml.jackson.databind.ser.std.BeanSerializerBase;
import org.springframework.data.neo4j.core.mapping.Neo4jMappingContext;
import org.springframework.data.neo4j.core.mapping.Neo4jPersistentEntity;
import org.springframework.data.neo4j.core.mapping.Neo4jPersistentProperty;
import org.springframework.data.neo4j.core.mapping.RelationshipDescription;

import java.lang.reflect.Modifier;
import java.util.*;

/**
 * Prints, as JSON, what the content service's Jackson and Spring Data Neo4j
 * make of each graph-core class -- read from the libraries themselves, never
 * restated. Run by snapshot-domain.mjs against the deployed webapp's jars.
 *
 * For each concrete class, `json`: the properties Jackson writes, in its order,
 * as [name, getter, declaring class, views], where views is a bit mask of the
 * StoichiometryView a property is written in (1 Flatten, 2 Nested,
 * 4 NestedAggregated) -- worked out as Jackson does, a property with no
 * @JsonView being in all of them; a fifth element "D" marks a floating-point
 * value, which Java writes as Double.toString does. The mapper is configured as
 * ObjectMapperConfig.defaultObjectMapper.
 *
 * For each class SDN maps, `graph`: its fields as SDN reads them. A property is
 * [field, graph property]; a relationship is [field, type, direction, target
 * class, collection, relationship class]. For a relationship class, `type` is
 * what its getType() returns. `defaults` are the property values a new
 * instance already holds: SDN constructs the object, then sets only the
 * properties the node has, so a constructor's value survives where the node
 * has none (ReferenceEntity's moleculeType).
 *
 * `store`: SDN's node descriptions in the order it searches them for a
 * relationship whose target is an interface (Trackable, Deletable), each as
 * [class, "interface" | "abstract" | "concrete", static labels].
 */
public class DomainSnapshot {
    @JsonIdentityInfo(generator = ObjectIdGenerators.PropertyGenerator.class, property = "dbId")
    public abstract static class DatabaseObjectMixin {
    }

    private static final String MODEL = "org.reactome.server.graph.domain.";
    private static final String[] VIEWS = {"Flatten", "Nested", "NestedAggregated"};

    public static void main(String[] args) throws Exception {
        List<Class<?>> classes = new ArrayList<>();
        // Classes after "--serialised-only" are written but never mapped: the
        // content service's own (SummaryEntity), built in code from mapped ones.
        // Kept out of SDN's mapping context, which they would join and reorder.
        Set<Class<?>> serialisedOnly = new LinkedHashSet<>();
        boolean only = false;
        for (String name : args) {
            if (name.equals("--serialised-only")) {
                only = true;
                continue;
            }
            Class<?> type = Class.forName(name);
            classes.add(type);
            if (only) serialisedOnly.add(type);
        }

        ObjectMapper mapper = new ObjectMapper();
        mapper.setSerializationInclusion(JsonInclude.Include.NON_EMPTY);
        mapper.addMixIn(Class.forName(MODEL + "model.DatabaseObject"), DatabaseObjectMixin.class);
        SerializerProvider provider = mapper.getSerializerProviderInstance();
        Class<?>[] views = new Class<?>[VIEWS.length];
        for (int i = 0; i < VIEWS.length; i++)
            views[i] = Class.forName(MODEL + "annotations.StoichiometryView$" + VIEWS[i]);

        Neo4jMappingContext context = new Neo4jMappingContext();
        // Has.Default is only serialized: it is built in code, never mapped.
        Set<Class<?>> mapped = new LinkedHashSet<>();
        for (Class<?> type : classes)
            if (!type.isMemberClass() && !serialisedOnly.contains(type)) mapped.add(type);
        context.setInitialEntitySet(mapped);
        context.initialize();

        StringBuilder out = new StringBuilder("{\"json\":{");
        String separator = "";
        for (Class<?> type : classes) {
            if (Modifier.isAbstract(type.getModifiers()) || type.isInterface()) continue;
            JsonSerializer<?> serializer = provider.findValueSerializer(type);
            while (serializer != null && !(serializer instanceof BeanSerializerBase))
                serializer = serializer.getDelegatee();
            if (serializer == null) continue;
            out.append(separator).append("\n").append(quote(type.getSimpleName())).append(":[");
            separator = ",";
            String comma = "";
            for (Iterator<PropertyWriter> it = ((BeanSerializerBase) serializer).properties(); it.hasNext(); ) {
                BeanPropertyWriter writer = (BeanPropertyWriter) it.next();
                int mask = 0;
                for (int i = 0; i < views.length; i++) if (included(writer.getViews(), views[i])) mask |= 1 << i;
                out.append(comma).append("[").append(quote(writer.getName())).append(",")
                        .append(quote(writer.getMember().getName())).append(",")
                        .append(quote(writer.getMember().getDeclaringClass().getSimpleName())).append(",")
                        .append(mask);
                Class<?> raw = writer.getType().getRawClass();
                if (raw == Double.class || raw == Float.class || raw == double.class || raw == float.class)
                    out.append(",\"D\"");
                out.append("]");
                comma = ",";
            }
            out.append("]");
        }

        out.append("},\n\"graph\":{");
        separator = "";
        for (Class<?> type : mapped) {
            if (!context.hasPersistentEntityFor(type)) continue;
            Neo4jPersistentEntity<?> entity = context.getPersistentEntity(type);
            Map<String, RelationshipDescription> relationships = new HashMap<>();
            for (RelationshipDescription description : entity.getRelationships())
                relationships.put(description.getFieldName(), description);
            out.append(separator).append("\n").append(quote(type.getSimpleName())).append(":{");
            separator = ",";
            if (entity.isRelationshipPropertiesEntity() && !Modifier.isAbstract(type.getModifiers()))
                out.append("\"type\":").append(quote((String) type.getMethod("getType").invoke(type.getDeclaredConstructor().newInstance()))).append(",");
            if (!Modifier.isAbstract(type.getModifiers()) && !entity.isRelationshipPropertiesEntity()) {
                Object fresh = type.getDeclaredConstructor().newInstance();
                out.append("\"defaults\":{");
                String between = "";
                for (Neo4jPersistentProperty property : entity) {
                    if (property.isRelationship() || property.getField() == null) continue;
                    property.getField().setAccessible(true);
                    Object value = property.getField().get(fresh);
                    if (value == null) continue;
                    out.append(between).append(quote(property.getFieldName())).append(":").append(mapper.writeValueAsString(value));
                    between = ",";
                }
                out.append("},");
            }
            out.append("\"fields\":[");
            String comma = "";
            for (Neo4jPersistentProperty property : entity) {
                out.append(comma);
                comma = ",";
                if (!property.isRelationship()) {
                    out.append("[").append(quote(property.getFieldName())).append(",").append(quote(property.getPropertyName())).append("]");
                    continue;
                }
                RelationshipDescription description = relationships.get(property.getFieldName());
                String collection = !property.isCollectionLike() ? ""
                        : SortedSet.class.isAssignableFrom(property.getType()) ? "SortedSet"
                        : Set.class.isAssignableFrom(property.getType()) ? "Set"
                        : List.class.isAssignableFrom(property.getType()) ? "List"
                        : property.getType().getSimpleName();
                out.append("[").append(quote(property.getFieldName())).append(",")
                        .append(quote(description.getType())).append(",")
                        .append(quote(description.getDirection().name())).append(",")
                        .append(quote(description.getTarget().getUnderlyingClass().getSimpleName())).append(",")
                        .append(quote(collection)).append(",")
                        .append(description.hasRelationshipProperties()
                                ? quote(description.getRelationshipPropertiesEntity().getUnderlyingClass().getSimpleName())
                                : "null")
                        .append("]");
            }
            out.append("]}");
        }
        out.append("},\n\"store\":[");
        // NodeDescriptionStore.values(), in its iteration order: the order SDN
        // searches for a concrete class when a relationship targets an interface.
        java.lang.reflect.Field storeField = Neo4jMappingContext.class.getDeclaredField("nodeDescriptionStore");
        storeField.setAccessible(true);
        Object store = storeField.get(context);
        java.lang.reflect.Method values = store.getClass().getDeclaredMethod("values");
        values.setAccessible(true);
        separator = "";
        for (Object description : (Collection<?>) values.invoke(store)) {
            org.springframework.data.neo4j.core.mapping.NodeDescription<?> node =
                    (org.springframework.data.neo4j.core.mapping.NodeDescription<?>) description;
            Class<?> type = node.getUnderlyingClass();
            out.append(separator).append("\n[").append(quote(type.getSimpleName())).append(",")
                    .append(quote(type.isInterface() ? "interface" : Modifier.isAbstract(type.getModifiers()) ? "abstract" : "concrete")).append(",[");
            String comma = "";
            for (String label : node.getStaticLabels()) {
                out.append(comma).append(quote(label));
                comma = ",";
            }
            out.append("]]");
            separator = ",";
        }
        out.append("],\n\"interfaces\":[");
        // The interfaces SDN maps as entities, which a relationship may target.
        separator = "";
        for (Class<?> type : mapped) {
            if (!type.isInterface() || !context.hasPersistentEntityFor(type)) continue;
            out.append(separator).append(quote(type.getSimpleName()));
            separator = ",";
        }
        out.append("]}\n");
        System.out.print(out);
    }

    /** Jackson's rule, with DEFAULT_VIEW_INCLUSION on: no @JsonView means every view. */
    private static boolean included(Class<?>[] declared, Class<?> active) {
        if (declared == null) return true;
        for (Class<?> view : declared) if (view.isAssignableFrom(active)) return true;
        return false;
    }

    private static String quote(String text) {
        return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
