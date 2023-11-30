<template>
  <v-container fluid>
    <v-row>
      <v-col cols="12" sm="6">
        <v-file-input label="Wireguardconfig.com zip file" @update:model-value="onChange"></v-file-input>
        <v-text-field v-model="interfaceName" label="interface name"></v-text-field>
        <v-text-field v-model="mtu" label="mtu"></v-text-field>
        <v-textarea v-model="input" auto-grow spellcheck="false" label="Wireguard host config"></v-textarea>
        <v-btn class="ma-2" @click="addEntry">Add client config</v-btn>
        <template v-for="(_, index) of clientConfigs" :key="index">
          <v-text-field v-model="clientConfigs[index].name" >
            <template #append>
              <v-btn block @click="removeEntry(index)">delete</v-btn>
            </template>
          </v-text-field>
          <v-textarea v-model="clientConfigs[index].content" auto-grow spellcheck="false" :label="`Client ${ index }`"/>
        </template>
      </v-col>
      <v-col cols="12" sm="6">
        <v-textarea :model-value="generatedHostConfig" auto-grow readonly label="Generated commands" :style="{ 'font-family': 'monospace' }"></v-textarea>
        <v-btn class="ma-2" @click="showDebug = !showDebug">Toggle debug info</v-btn>
        <template v-if="showDebug">
          <v-textarea :model-value="JSON.stringify(output, undefined, 4)" auto-grow readonly label="Parsed Host"></v-textarea>
          <template v-for="(client, index) of parsedClients" :key="index">
            <v-text-field :model-value="client.name" readonly></v-text-field>
            <v-textarea :model-value="JSON.stringify(client.value, undefined, 4)" auto-grow readonly label="Parsed Client"></v-textarea>
          </template>
        </template>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { ref } from 'vue';
import { parseIni } from '../utils/ini'
import jsZIP from 'jszip'

interface ClientInfo {
  name: string,
  content: string,
}

const interfaceName = ref('wireguard-server')
// const listenPort = ref('51280')
const mtu = ref('1420')
const input = ref('')
const clientConfigs = ref<ClientInfo[]>([])
const showDebug = ref(false)

const addEntry = () => {
  clientConfigs.value.push({ name: 'client', content: 'content' })
}
const removeEntry = (index: number) => {
  clientConfigs.value.splice(index, 1)
}
const onChange = async (files: File[]) => {
  console.log(files)
  for (const file of files) {
    const res = await jsZIP.loadAsync(file)
    console.log(res.files)

    const entries = Object.entries(res.files)

    const serverFile = entries.find(i => !i[1].dir && /server/.test(i[1].name))!
    const clients = entries.filter(i => !i[1].dir && !/server/.test(i[1].name))

    const server = await serverFile[1].async('string')
    input.value = server
    clientConfigs.value = []
    for (let [, client] of clients) {
      const segment = client.name.split('/')
      const name = segment[segment.length - 1]
      const content = await client.async('string')
      clientConfigs.value.push({ name, content })
    }
  }
}
const output = computed(() => {
  try {
    const res = parseIni(input.value, { arraySections: ['Peer'] })
    return res
  } catch (err) {
    return null
  }
})

const listenPort = computed(() => {
  const port = output.value?.Interface?.ListenPort ?? '0'
  return port
})

const parsedClients = computed(() => {
  const resList: { name:string, value: any}[] = []
  for (const client of clientConfigs.value) {
    try {
      const res = parseIni(client.content, { arraySections: ['Peer'] })
      resList.push({ name: client.name, value: res})
    } catch (err) { /* empty */ }
  }
  return resList
})

const wrapJoin = (segments: string[], wrapPad = '    ', lineWidth = 80) => {
  const lines = []
  let unfinishedLine = ''

  for (const segment of segments) {
    if ((unfinishedLine.length + 1 + segment.length > lineWidth) && segment.length < lineWidth - wrapPad.length) {
      lines.push(unfinishedLine + ' \\')
      unfinishedLine = wrapPad
    }
    if (unfinishedLine === '') {
      unfinishedLine = segment
    } else if (/^\s+$/.test(unfinishedLine)) {
      unfinishedLine += segment
    } else {

      unfinishedLine += ' ' + segment
    }
  }

  if (unfinishedLine !== '') {
    lines.push(unfinishedLine)
  }
  return lines.join('\n')
}

const generatedHostConfig = computed(() => {
  if (output.value?.Interface?.Address) {
    const commands: string[] = []
    commands.push('/interface wireguard')
    commands.push(wrapJoin([
      'add',
      `listen-port=${listenPort.value}`,
      `mtu=${mtu.value}`,
      `name=${interfaceName.value}`,
      `private-key="${output.value?.Interface?.PrivateKey}"`,
    ]))
    if (output.value?.Peer?.length > 0) {
      commands.push('/interface wireguard peers')
      for (const peer of output.value?.Peer ?? []) {
        let commandSegments = ['add']
        commandSegments.push(`allowed-address=${peer.AllowedIPs}`)
        commandSegments.push(`client-address=${peer.AllowedIPs}`)
        const matchingConfig = parsedClients.value.find(i => i.value?.Interface?.Address?.split('/')?.[0] === peer.AllowedIPs?.split('/')?.[0])
        if (matchingConfig) {
          const endpoint = matchingConfig.value?.Peer?.[0]?.Endpoint
          if (endpoint) {
            // remove port number because it will be appended by router os
            commandSegments.push(`client-endpoint=${endpoint.split(':')[0]}`)
          }
        }
        commandSegments.push(`interface=${interfaceName.value}`)
        if (matchingConfig) {
          const privateKey = matchingConfig.value?.Interface?.PrivateKey
          if (privateKey) {
            commandSegments.push(`private-key="${privateKey}"`)
          }
        }
        const publicKey = peer?.PublicKey
        commandSegments.push(`public-key="${publicKey}"`)
        if (matchingConfig) {
          const dns = matchingConfig.value?.Interface?.DNS
          if (dns) {
            commandSegments.push(`client-dns=${dns}`)
          }
        }
        if (matchingConfig) {
          commandSegments.push(`comment=${JSON.stringify(matchingConfig.name)}`)
        }
        commands.push(wrapJoin(commandSegments))
      }
    }
    return commands.join('\n')
  } else {
    return ''
  }

})

/**
/interface wireguard
add listen-port=51820 mtu=1420 name=wireguard-server private-key=\
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
 */
/**
/interface wireguard peers
add allowed-address=192.168.1.1/32 client-address=192.168.1.1/32 \
    client-endpoint=example.com:51820 interface=wireguard-server \
    private-key="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" public-key=\
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
 */
</script>
