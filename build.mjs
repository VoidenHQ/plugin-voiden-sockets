#!/usr/bin/env node
import { build } from 'vite'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const manifest = JSON.parse(readFileSync('./manifest.json', 'utf8'))
const pluginId = manifest.id
const entry = existsSync('./src/plugin.ts') ? './src/plugin.ts' : './src/index.ts'

// Minimal shims — react and SDK modules come from the host app at runtime
const STATIC_SHIMS = {
  'react': `const _s=window.__voiden_shims__['react'];export default _s;export const {useState,useEffect,useCallback,useMemo,useRef,useContext,createContext,forwardRef,memo,Fragment,createElement,cloneElement,Children,StrictMode,Suspense,lazy,isValidElement,Component,PureComponent,createRef,startTransition,useReducer,useLayoutEffect,useImperativeHandle,useDebugValue,useTransition,useDeferredValue,useId}=_s;`,
  'react/jsx-runtime': `const _s=window.__voiden_shims__['react/jsx-runtime'];export const jsx=_s.jsx;export const jsxs=_s.jsxs;export const Fragment=_s.Fragment;`,
  'react-dom': `const _s=window.__voiden_shims__['react-dom'];export default _s;export const {createPortal,flushSync,render,unmountComponentAtNode}=_s;`,
  'react-dom/client': `const _s=window.__voiden_shims__['react-dom/client'];export default _s;export const {createRoot,hydrateRoot}=_s;`,
  '@tanstack/react-query': `const _s=window.__voiden_shims__['@tanstack/react-query'];export default _s;export const {useQuery,useMutation,useQueryClient,useInfiniteQuery,QueryClient,QueryClientProvider,QueryCache,MutationCache,useIsFetching,useIsMutating,useSuspenseQuery,useSuspenseInfiniteQuery,useSuspenseQueries,useQueries,HydrationBoundary,dehydrate,hydrate,focusManager,onlineManager,replaceEqualDeep,hashKey}=_s;`,
  '@tiptap/react': `const _s=window.__voiden_shims__['@tiptap/react'];export default _s;export const {ReactNodeViewRenderer,NodeViewWrapper,NodeViewContent,useEditor,EditorContent,ReactRenderer,FloatingMenu,BubbleMenu,useReactNodeView,useCurrentEditor}=_s;`,
  '@codemirror/state': `const _s=window.__voiden_shims__['@codemirror/state'];export default _s;export const {Extension,RangeSetBuilder,StateField,EditorState,Prec,Annotation,AnnotationType,ChangeDesc,ChangeSet,Compartment,EditorSelection,Facet,Line,MapMode,Range,RangeSet,RangeValue,SelectionRange,StateEffect,StateEffectType,Text,Transaction,combineConfig,countColumn,findClusterBreak,findColumn}=_s;`,
  '@codemirror/view': `const _s=window.__voiden_shims__['@codemirror/view'];export default _s;export const {keymap,EditorView,Decoration,DecorationSet,WidgetType,ViewPlugin,ViewUpdate,MatchDecorator,GutterMarker,drawSelection,dropCursor,highlightActiveLine,highlightSpecialChars,lineNumbers,rectangularSelection,scrollPastEnd}=_s;`,
  '@codemirror/autocomplete': `const _s=window.__voiden_shims__['@codemirror/autocomplete'];export default _s;export const {CompletionContext,CompletionResult,autocompletion,completeAnyWord,closeBrackets,closeBracketsKeymap,completionKeymap,ifIn,ifNotIn,snippetCompletion}=_s;`,
}

// Additional runtime shims for host-provided packages
const ADDITIONAL_SHIMS = {
  '@tiptap/core': "const _s=window.__voiden_shims__['@tiptap/core']||{};export default _s;export const {Editor,Extension,Node,NodeViewProps,Range,JSONContent,generateJSON,mergeAttributes}=_s;",
  '@tiptap/pm/model': "const _s=window.__voiden_shims__['@tiptap/pm/model']||{};export default _s;export const {DOMParser,Fragment,Node,Slice}=_s;",
  '@tiptap/pm/state': "const _s=window.__voiden_shims__['@tiptap/pm/state']||{};export default _s;export const {EditorState,Plugin,PluginKey}=_s;",
  '@tiptap/pm/tables': "const _s=window.__voiden_shims__['@tiptap/pm/tables']||{};export default _s;export const {CellSelection}=_s;",
  '@tiptap/pm/view': "const _s=window.__voiden_shims__['@tiptap/pm/view']||{};export default _s;export const {EditorView}=_s;",
  '@tiptap/suggestion': "const _s=window.__voiden_shims__['@tiptap/suggestion']||{};export default _s;",
  'lucide-react': "const _s=window.__voiden_shims__['lucide-react']||{};export default _s;export const {AlertCircle,ArrowDown,ArrowDownLeft,ArrowLeft,ArrowLeftRight,ArrowRight,ArrowUp,ArrowUpRight,BookOpen,Check,CheckCheck,ChevronDown,ChevronRight,ChevronsDownUp,ChevronsUpDown,Circle,CircleAlert,CircleX,Clock,Copy,CornerDownLeft,CornerDownRight,Download,ExternalLink,Eye,FileDown,FileText,Folder,FolderOpen,History,Info,Link,Loader,Loader2,Mouse,Pen,Pencil,Play,Plus,Radio,Rows,Search,SkipForward,Sparkles,Square,Trash2,Unlink,Wifi,WifiOff,WrapText,X,XCircle}=_s;",
  'zustand': "const _s=window.__voiden_shims__['zustand']||{};export default _s;export const {create}=_s;",
  '@faker-js/faker': "const _s=window.__voiden_shims__['@faker-js/faker']||{};export default _s;export const {faker}=_s;",
  'js-yaml': "const _s=window.__voiden_shims__['js-yaml']||{};export default _s;export const {load,dump,loadAll}=_s;",
  'unified': "const _s=window.__voiden_shims__['unified']||{};export default _s;export const {unified}=_s;",
  'prosemirror-markdown': "const _s=window.__voiden_shims__['prosemirror-markdown']||{};export default _s;export const {defaultMarkdownParser,defaultMarkdownSerializer}=_s;",
  'shell-quote': "const _s=window.__voiden_shims__['shell-quote']||{};export default _s;export const {parse,quote,ControlOperator,ParseEntry}=_s;",
  'remark-gfm': "const _s=window.__voiden_shims__['remark-gfm']||{};export default _s;",
  'remark-parse': "const _s=window.__voiden_shims__['remark-parse']||{};export default _s;",
  'remark-stringify': "const _s=window.__voiden_shims__['remark-stringify']||{};export default _s;",
  'react-markdown': "const _s=window.__voiden_shims__['react-markdown']||{};export default _s;",
  'markdown-it': "const _s=window.__voiden_shims__['markdown-it']||{};export default _s;",
  'yaml': "const _s=window.__voiden_shims__['yaml']||{};export default _s;export const {parse,stringify}=_s;",
  'xlsx-js-style': "const _s=window.__voiden_shims__['xlsx-js-style']||{};export default _s;",
  '@voiden/sdk': "const _s=window.__voiden_shims__['@voiden/sdk']||{};export default _s;export const {PipelineStage,PluginContext,RequestCompilationContext,SlashCommandGroup,UIExtension}=_s;",
  '@voiden/sdk/shared': "const _s=window.__voiden_shims__['@voiden/sdk/shared']||{};export default _s;export const {Request,RequestParam,parseCookies}=_s;",
  'tippy.js': "const _s=window.__voiden_shims__['tippy.js']||{};export default _s;",
  'buffer': "export const Buffer=globalThis.Buffer;export default{Buffer:globalThis.Buffer};",
}
Object.assign(STATIC_SHIMS, ADDITIONAL_SHIMS)

// Core host modules
const CORE_EXPORTS = {
  '@voiden/sdk/ui': ['PluginContext','CorePluginContext','Plugin','SlashCommand','SlashCommandGroup','Tab','EditorAction','StatusBarItem','PluginHelpers','BlockPasteHandler','BlockExtension','PatternHandler'],
  '@/core/file-system/hooks/useFileSystem': ['prosemirrorToMarkdown'],
  '@/core/editors/voiden/extensions': ['voidenExtensions'],
  '@/core/editors/voiden/VoidenEditor': ['useEditorStore','useVoidenEditorStore','proseClasses'],
  '@/core/editors/voiden/utils/expandLinkedBlocks': ['expandLinkedBlocksInDoc'],
  '@/core/editors/voiden/markdownConverter': ['parseMarkdown'],
  '@/core/request-engine/getRequestFromJson': ['getTable','parseAuthNode','buildHeadersWithCookies','findNode','findNodes','createNewRequestObject','getRequest'],
  '@/core/request-engine/stores/responseStore': ['useResponseStore'],
  '@/core/request-engine/requestOrchestrator': ['requestOrchestrator'],
  '@/core/request-engine/runtimeVariables': ['replaceProcessVariablesInText'],
  '@/core/request-engine/pipeline': ['hookRegistry','PipelineStage'],
  '@/core/history/adapterRegistry': ['historyAdapterRegistry'],
  '@/core/stores/panelStore': ['usePanelStore'],
  '@/core/stores/responsePanelPosition': ['getResponsePanelPosition'],
  '@/core/environment/hooks': ['useActiveEnvironment','useEnvironments'],
  '@/plugins': ['useEditorEnhancementStore','usePluginStore'],
  '@/main': ['getQueryClient'],
}

function shimPlugin() {
  return {
    name: 'voiden-shims',
    enforce: 'pre',
    resolveId(id) {
      if (id in STATIC_SHIMS) return `\0shim:${id}`
      if (id in CORE_EXPORTS) return `\0shim:${id}`
      // Catch-all: shim any bare package specifier not already handled
      if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0') && !id.startsWith('node:') && !id.startsWith('\\')) {
        return `\0shim:${id}`
      }
      return null
    },
    load(id) {
      if (!id.startsWith('\0shim:')) return null
      const mod = id.slice('\0shim:'.length)
      if (mod in STATIC_SHIMS) return STATIC_SHIMS[mod]
      const exports = CORE_EXPORTS[mod] || []
      const key = JSON.stringify(mod)
      const named = exports.map(n => `export const ${n}=_s.${n};`).join('\n')
      return `const _s=(window.__voiden_shims__||{})[${key}]||{};export default _s;\n${named}`
    },
    renderChunk(code) {
      const mfStr = JSON.stringify(manifest)
      return { code: `globalThis["__voiden_bundle_version__"]=2;\nexport const __voiden_bundle_version__=2;\nexport const __voiden_manifest__=${mfStr};\n${code}`, map: null }
    }
  }
}

await build({
  configFile: false,
  plugins: [
    shimPlugin(),
    { name:'skip-css', resolveId(id){if(id.endsWith('.css'))return'\0empty'},load(id){if(id==='\0empty')return'export default {}'} },
    { name:'node-buffer',enforce:'pre',resolveId(id){if(id==='buffer')return'\0buf'},load(id){if(id==='\0buf')return'export const Buffer=globalThis.Buffer;export default{Buffer:globalThis.Buffer}'} },
  ],
  esbuild: { jsx: 'automatic' },
  build: {
    lib: { entry, formats: ['es'], fileName: () => `${pluginId}.js` },
    outDir: 'dist',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    rollupOptions: {
      onwarn(w,warn){if(w.code==='MODULE_LEVEL_DIRECTIVE'||w.code==='UNRESOLVED_IMPORT')return;warn(w)},
      output: { inlineDynamicImports: true }
    }
  },
  logLevel: 'info'
})
