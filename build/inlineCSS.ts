import path from 'path'
import esbuild from 'esbuild'

type PluginBuild = esbuild.PluginBuild

const inlineCSS = {
    name: 'inlineCSS',
    setup(build: PluginBuild) {
        build.onResolve({ filter: /\.css$/ }, (args) => {
            return {
                path: path.join(args.resolveDir, args.path),
                namespace: 'inlineCSS'
            }
        })
        build.onLoad({ filter: /.*/, namespace: 'inlineCSS' }, async (args) => {
            try {
                const result = await build.esbuild.build({
                    entryPoints: [args.path],
                    write: false,
                    loader: {
                        '.css': 'css'
                    },
                    minify: true,
                    platform: 'neutral'
                })
                const cssContent = result.outputFiles[0].text.trim()
                const contents = `export default ${JSON.stringify(cssContent)};`
                return {
                    contents,
                    loader: 'js'
                }
            } catch (error) {
                return {
                    errors: [
                        {
                            text: `Failed to inline CSS: ${error}`,
                            detail: error
                        }
                    ]
                }
            }
        })
    }
}
export default inlineCSS
