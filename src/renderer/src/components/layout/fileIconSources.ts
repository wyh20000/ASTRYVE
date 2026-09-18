import astro from '../../assets/file-icons/astro.svg'
import consoleIcon from '../../assets/file-icons/console.svg'
import css from '../../assets/file-icons/css.svg'
import database from '../../assets/file-icons/database.svg'
import docker from '../../assets/file-icons/docker.svg'
import document from '../../assets/file-icons/document.svg'
import file from '../../assets/file-icons/file.svg'
import font from '../../assets/file-icons/font.svg'
import git from '../../assets/file-icons/git.svg'
import go from '../../assets/file-icons/go.svg'
import html from '../../assets/file-icons/html.svg'
import image from '../../assets/file-icons/image.svg'
import java from '../../assets/file-icons/java.svg'
import javascript from '../../assets/file-icons/javascript.svg'
import json from '../../assets/file-icons/json.svg'
import lock from '../../assets/file-icons/lock.svg'
import makefile from '../../assets/file-icons/makefile.svg'
import markdown from '../../assets/file-icons/markdown.svg'
import nodejs from '../../assets/file-icons/nodejs.svg'
import python from '../../assets/file-icons/python.svg'
import react from '../../assets/file-icons/react.svg'
import reactTs from '../../assets/file-icons/react_ts.svg'
import rust from '../../assets/file-icons/rust.svg'
import svelte from '../../assets/file-icons/svelte.svg'
import tsconfig from '../../assets/file-icons/tsconfig.svg'
import typescript from '../../assets/file-icons/typescript.svg'
import vue from '../../assets/file-icons/vue.svg'
import xml from '../../assets/file-icons/xml.svg'
import yaml from '../../assets/file-icons/yaml.svg'

/**
 * The icons are bundled locally so the workspace remains usable offline and
 * does not depend on a remote icon host at runtime.
 */
export const fileIconSources: Record<string, string> = {
  astro, console: consoleIcon, css, database, docker, document, file, font,
  git, go, html, image, java, javascript, json, lock, makefile, markdown,
  nodejs, python, react, react_ts: reactTs, rust, svelte, tsconfig, typescript,
  vue, xml, yaml
}
