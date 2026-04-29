import CodeEditor from './CodeEditor'
import Terminal from './Terminal'
import Notes from './Notes'
import SSHTerminal from './SSHTerminal'

const registry = {
  'code-editor': {
    title: 'Code Editor',
    icon: '⚡',
    component: CodeEditor,
    defaultWidth: 550,
    defaultHeight: 400,
  },
  terminal: {
    title: 'Terminal',
    icon: '▸',
    component: Terminal,
    defaultWidth: 500,
    defaultHeight: 320,
  },
  notes: {
    title: 'Notes',
    icon: '✎',
    component: Notes,
    defaultWidth: 380,
    defaultHeight: 350,
  },
  ssh: {
    title: 'SSH',
    icon: '🔗',
    component: SSHTerminal,
    defaultWidth: 600,
    defaultHeight: 400,
  },
}

export default registry