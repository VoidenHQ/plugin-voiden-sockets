export const insertSocketNode = (editor: any, type: "wss" | "grpcs") => {
  const { from, to } = editor.state.selection;

  const config = {
    wss: {
      method: "WSS",
      url: "wss://"
    },
    grpcs: {
      method: "GRPCS",
      url: "grpcs://",
      needsProtoFile: true
    }
  }[type];

  {
    const content: any[] = [
      {
        type: "smethod",
        attrs: { method: config.method },
        content: [{ type: "text", text: config.method }]
      },
      {
        type: "surl",
        content: [{ type: "text", text: config.url }]
      }
    ];

    // Add proto-file node for gRPC
    if (config.needsProtoFile) {
      content.push({
        type: "proto",
        // Empty content is fine now
      });
    }

    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContent({
        type: "socket-request",
        content: content
      })
      .run();

    setTimeout(() => {
      const urlNode = editor.$node("surl");
      if (urlNode && urlNode.textContent === config.url) {
        editor.commands.focus(urlNode.from + config.url.length);
      }
    }, 50);
  }
};