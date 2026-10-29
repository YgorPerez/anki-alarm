/** Phone-only scale. Keep shared tokens (and the web's scale) unchanged. */
export default {
  meta: { name: "mobile-design" },
  rules: {
    "two-radius": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          radius:
            "Phone radii must use rounded-pill (press) or rounded-lg (16px container); inline radii must be 999 or 16.",
        },
      },
      create(context) {
        function checkClasses(node, text) {
          for (const token of text.split(/\s+/)) {
            const radius = token.match(/(?:^|:)!?(rounded(?:-.*)?)/)?.[1]?.replace(/!$/, "");
            if (radius && radius !== "rounded-pill" && radius !== "rounded-lg")
              context.report({ node, messageId: "radius" });
          }
        }
        function checkRadius(node, key, value) {
          if (
            /^border(?:[A-Z][a-z]+)*Radius$/.test(key) &&
            !(value.type === "Literal" && (value.value === 16 || value.value === 999))
          )
            context.report({ node, messageId: "radius" });
        }
        return {
          JSXAttribute(node) {
            if (node.value)
              checkRadius(
                node,
                node.name.name,
                node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value,
              );
          },
          AssignmentExpression(node) {
            if (node.left.type === "MemberExpression")
              checkRadius(
                node,
                node.left.property.name ?? node.left.property.value ?? "",
                node.right,
              );
          },
          Property(node) {
            checkRadius(node, node.key.name ?? node.key.value ?? "", node.value);
          },
          Literal(node) {
            if (typeof node.value === "string") checkClasses(node, node.value);
          },
          TemplateElement(node) {
            checkClasses(node, node.value.raw);
          },
        };
      },
    },
  },
};
