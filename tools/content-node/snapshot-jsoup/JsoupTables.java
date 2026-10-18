import org.jsoup.nodes.Entities;
import org.jsoup.parser.Tag;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.TreeMap;

/**
 * Prints jsoup-tables.json: the Jsoup the Java content service ships, its
 * named entities ([isBase, ...code points]) and its known tags ([isBlock,
 * preserveWhitespace, isEmpty, formatAsBlock]), which jsoup-text.mjs reads.
 * Run with that Jsoup on the classpath, from the repository root:
 *
 *   java -cp <WEB-INF/lib>/jsoup-<version>.jar \
 *     tools/content-node/snapshot-jsoup/JsoupTables.java > tools/content-node/jsoup-tables.json
 *
 * WHEN: when the content service's Jsoup changes. THEN: run jsoup-text.spec.mjs,
 * and compare jsoupText with Jsoup over the graph's summations.
 */
public class JsoupTables {
    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        Field names = Entities.EscapeMode.class.getDeclaredField("nameKeys");
        names.setAccessible(true);
        StringBuilder out = new StringBuilder("{\"entities\":{");
        int[] points = new int[2];
        String comma = "";
        for (String name : (String[]) names.get(Entities.EscapeMode.extended)) {
            int count = Entities.codepointsForName(name, points);
            out.append(comma).append('"').append(name).append("\":[").append(Entities.isBaseNamedEntity(name) ? 1 : 0);
            for (int i = 0; i < count; i++) out.append(',').append(points[i]);
            out.append(']');
            comma = ",";
        }
        out.append("},\"tags\":{");
        Field tagsField = Tag.class.getDeclaredField("tags");
        tagsField.setAccessible(true);
        comma = "";
        for (Map.Entry<String, Tag> entry : new TreeMap<>((Map<String, Tag>) tagsField.get(null)).entrySet()) {
            Tag tag = entry.getValue();
            out.append(comma).append('"').append(entry.getKey()).append("\":[")
                    .append(tag.isBlock() ? 1 : 0).append(',').append(tag.preserveWhitespace() ? 1 : 0).append(',')
                    .append(tag.isEmpty() ? 1 : 0).append(',').append(tag.formatAsBlock() ? 1 : 0).append(']');
            comma = ",";
        }
        out.append("}}\n");
        System.out.print(out);
    }
}
