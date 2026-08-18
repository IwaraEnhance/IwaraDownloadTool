import { readFile } from 'fs/promises'
import esbuild from 'esbuild'

type PluginBuild = esbuild.PluginBuild

const minifyModules = {
    name: 'minifyModules',
    setup(build: PluginBuild) {
        build.onLoad({ filter: /node_modules/ }, async (args) => {
            const source = await readFile(args.path, 'utf8')
            const result = await esbuild.transform(source, { minify: true })
            return { contents: result.code }
        })
    }
}

export default minifyModules
