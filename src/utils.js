import { increment, decrement, set, get } from "automate-redux"
import { cloneDeep } from "lodash"
import { notification } from "antd"
import client from "./client"
import history from "./history"
import store from "./store"
import { defaultDbConnectionStrings } from "./constants"

export const openProject = (projectId) => {
  const currentURL = window.location.pathname
  const projectURL = `/mission-control/projects/${projectId}`
  if (!currentURL.includes(projectURL)) {
    history.push(projectURL)
  }
  const projects = get(store.getState(), "projects", [])
  const config = projects.find(project => project.id === projectId)
  if (!config) {
    notify("error", "Error", "Project does not exist")
    return
  }

  const adjustedConfig = adjustConfig(cloneDeep(config))
  store.dispatch(set("config", adjustedConfig))
  store.dispatch(set("savedConfig", cloneDeep(adjustedConfig)))
}

export const adjustConfig = (config) => {
  // Adjust database rules
  if (config.modules && config.modules.crud) {
    Object.keys(config.modules.crud).forEach(db => {
      if (config.modules.crud[db].collections) {
        Object.keys(config.modules.crud[db].collections).forEach(col => {
          config.modules.crud[db].collections[col].rules = JSON.stringify(config.modules.crud[db].collections[col].rules, null, 2)
        })
      }
    })
  }

  // Adjust function rules
  if (config.modules && config.modules.functions && config.modules.functions.services) {
    Object.keys(config.modules.functions.services).forEach(service => {
      config.modules.functions.services[service] = JSON.stringify(config.modules.functions.services[service], null, 2)
    })
  }

  // Adjust file storage rules
  if (config.modules && config.modules.fileStore && config.modules.fileStore.rules) {
    config.modules.fileStore.rules = config.modules.fileStore.rules.map(rule => JSON.stringify(rule, null, 2))
  }

  return config
}

export const unAdjustConfig = (c, s) => {
  let config = cloneDeep(c)
  let staticConfig = cloneDeep(s)
  let result = { ack: true, errors: { crud: {}, functions: [], fileStore: [], static: [] } }
  // Unadjust database rules
  if (config.modules && config.modules.crud) {
    Object.keys(config.modules.crud).forEach(db => {
      if (config.modules.crud[db].collections) {
        Object.keys(config.modules.crud[db].collections).forEach(col => {
          try {
            config.modules.crud[db].collections[col].rules = JSON.parse(config.modules.crud[db].collections[col].rules)
          } catch (error) {
            result.ack = false
            result.errors.crud[db] = result.errors.crud[db] ? [...result.errors.crud[db], col] : [col]
          }
        })
      }
    })
  }

  // Unadjust function rules
  if (config.modules && config.modules.functions && config.modules.functions.services) {
    Object.keys(config.modules.functions.services).forEach(service => {
      try {
        config.modules.functions.services[service] = JSON.parse(config.modules.functions.services[service])
      } catch (error) {
        result.ack = false
        result.errors.functions.push(service)
      }
    })
  }

  // Unadjust file storage rules
  if (config.modules && config.modules.fileStore && config.modules.fileStore.rules) {
    config.modules.fileStore.rules = config.modules.fileStore.rules.map((rule, index) => {
      try {
        return JSON.parse(rule)
      } catch (error) {
        result.ack = false
        result.errors.functions.push(`Rule ${index + 1}`)
      }
    })
  }

  // Unadjust file storage rules
  if (staticConfig && staticConfig.routes) {
    staticConfig.routes = staticConfig.routes.map((rule, index) => {
      try {
        return JSON.parse(rule)
      } catch (error) {
        result.ack = false
        result.errors.static.push(`Rule ${index + 1}`)
      }
    })
  }

  result.config = config
  result.staticConfig = staticConfig
  return result
}

export const notify = (type, title, msg, duration) => {
  notification[type]({ message: title, description: msg, duration: duration });
}

const generateProjectId = (projectName) => {
  return projectName.toLowerCase().replace(/\s+|-/g, '_');
}

const getConnString = (dbType) => {
  const connString = defaultDbConnectionStrings[dbType]
  return connString ? connString : "localhost"
}

const defaultRules = {
  create: {
    rule: 'allow'
  },
  read: {
    rule: 'allow'
  },
  update: {
    rule: 'allow'
  },
  delete: {
    rule: 'allow'
  }
}

export const generateProjectConfig = (name, dbType) => ({
  name: name,
  id: generateProjectId(name),
  secret: generateId(),
  modules: {
    crud: {
      [dbType]: {
        enabled: true,
        conn: getConnString(dbType),
        collections: {
          default: {
            isRealtimeEnabled: true,
            rules: defaultRules
          },
          events_log: {
            isRealtimeEnabled: false,
            schema: `type events_log {
  _id: ID! @id
  batchid: String
  type: String
  token: Integer
  timestamp: Integer
  event_timestamp: Integer
  payload: String
  status: String
  retries: Integer
  service: String
  func: String              
}`,
            rules: defaultRules
          }
        }
      }
    },
    eventing: {
      enabled: true,
      dbType: dbType,
      col: "events_log"
    },
    auth: {},
    functions: {
      services: {
        default: {
          functions: {
            default: {
              rule: {
                rule: "allow"
              }
            }
          }
        }
      }
    },
    fileStore: {
      enabled: false,
      storeType: "local",
      conn: "./",
      rules: []
    },
    static: {
      enabled: true,
      routes: []
    }
  }
})

/* 
* Fetches does all those tasks that are to be done after a successful login with Mission Control UI
* or to be done if the person was logged in already (i.e a token was present in localStorage).
* It fetches all the projects, deployConfig, operationConfig and saves them in redux.
* It also redirects to the welcome page if the user has no projects.
* If the user has projects then it opens the last project (if provided) or the first project
* Else it redirects the user to welcome page if user has no projects.
*/
export const handleClusterLoginSuccess = (token, lastProjectId) => {
  if (token) {
    client.setToken(token)
  }

  store.dispatch(increment("pendingRequests"))
  Promise.all([client.fetchProjects(), client.fetchDeployCofig(), client.fetchOperationCofig(), client.fetchStaticConfig()])
    .then(([projects, deployConfig, operationConfig, staticConfig]) => {
      // Save deploy config
      const adjustedDeployConfig = adjustConfig(deployConfig)
      store.dispatch(set("deployConfig", adjustedDeployConfig))
      store.dispatch(set("savedDeployConfig", cloneDeep(adjustedDeployConfig)))
      // Save static config
      let adjustedStaticConfig = cloneDeep(staticConfig)

      if (!adjustedStaticConfig || !adjustedStaticConfig.routes) {
        adjustedStaticConfig = { routes: [] }
      }
      adjustedStaticConfig.routes = adjustedStaticConfig.routes.map(rule => JSON.stringify(rule, null, 2))
      store.dispatch(set("staticConfig", adjustedStaticConfig))
      store.dispatch(set("savedStaticConfig", cloneDeep(adjustedStaticConfig)))

      // Save operation config
      store.dispatch(set("operationConfig", operationConfig))

      // Save projects
      store.dispatch(set("projects", projects))
      if (projects.length === 0) {
        history.push(`/mission-control/welcome`)
        return
      }

      // Open last project
      if (!lastProjectId) {
        lastProjectId = projects[0].id
      }
      openProject(lastProjectId)
    })
    .catch(error => {
      console.log("Error", error)
      notify("error", "Error", 'Could not fetch config')
    })
    .finally(() => store.dispatch(decrement("pendingRequests")))
}

export const handleSpaceUpLoginSuccess = (token) => {
  store.dispatch(increment("pendingRequests"))
  client.setSpaceApiToken(token)
  client.fetchSpaceProfile().then(user => {
    const date = new Date()
    const month = date.getMonth()
    const year = date.getFullYear()
    const mode = Object.assign({}, get(store.getState(), "operationConfig.mode", 0))
    let deployConfig = Object.assign({}, get(store.getState(), "deployConfig", {}))
    const defaultDeployConfig = {
      enabled: false,
      orchestrator: "kubernetes",
      namespace: "default",
      registry: {
        url: "https://api.spaceuptech.com",
        id: user.id,
        key: user.key
      }
    }
    if (deployConfig.enabled) {
      deployConfig.registry = Object.assign({}, deployConfig.registry, { id: user.id, key: user.key })
    } else {
      deployConfig = defaultDeployConfig
    }

    Promise.all([client.fetchCredits(user.id), client.fetchBilling(user.id, month, year), client.saveDeployConfig(deployConfig)]).then(([credits, billing]) => {
      store.dispatch(set("credits", credits))
      store.dispatch(set("billing", billing))
      store.dispatch(set("deployConfig", deployConfig))
      store.dispatch(set("savedDeployConfig", cloneDeep(deployConfig)))
    })
    store.dispatch(set("user", user))
  }).catch(error => {
    console.log("Error", error)
    notify("error", "Error", 'Could not fetch profile')
  }).finally(() => store.dispatch(decrement("pendingRequests")))
}

export const generateId = () => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const isUserSignedIn = () => {
  const userId = get(store.getState(), "user.id", "")
  return userId && userId.length > 0
}

export const triggerSignin = () => {
  store.dispatch(set("uiState.isSigninModalVisible", true))
}

export const openPlansPage = () => {
  const projectId = get(store.getState(), "config.id")
  history.push(`/mission-control/projects/${projectId}/plans`)
}

export const onAppLoad = () => {
  client.fetchEnv().then(isProd => {
    const token = localStorage.getItem("token")
    const spaceUpToken = localStorage.getItem("space-up-token")
    if (isProd && !token) {
      history.push("/mission-control/login")
      return
    }

    let lastProjectId = null
    const urlParams = window.location.pathname.split("/")
    if (urlParams.length > 3 && urlParams[3]) {
      lastProjectId = urlParams[3]
    }

    handleClusterLoginSuccess(token, lastProjectId)

    if (spaceUpToken) {
      handleSpaceUpLoginSuccess(spaceUpToken)
    }
  })
}

export const sortRulesByPrefix = (rules) => {
  return rules.sort((a, b) => {
    if (!a.prefix) return 1
    const keysA = a.prefix.split("/").slice(1)
    const keysB = b.prefix.split("/").slice(1)
    const totalKeysA = keysA.length
    const totalKeysB = keysB.length
    for (var i = 0; i < totalKeysA; i++) {
      const keyA = keysA[i]
      const keyB = keysB[i]
      if (!keyB) return -1
      if (keyA === keyB) continue
      if (keyA.charAt(0) === "{") {
        if (keyB.charAt(0) === "{") continue
        else return 1
      }
      if (keyB.charAt(0) === "{") return -1
      return keyA < keyB ? -1 : 1
    }
    return (totalKeysA < totalKeysB) ? 1 : -1
  })
}

export const createTable = (projectId, db, collectionName, rules, schema, realtimeEnabled) => {
  let collection = {
    isRealtimeEnabled: realtimeEnabled,
    rules: rules,
    schema: schema
  }
  if (db === 'mongo') {
    store.dispatch(set(`config.modules.crud.${db}.collections.${collectionName}`, collection))
    return
  }

  store.dispatch(increment("pendingRequests"))
  client.handleModifyTable(projectId, db, collectionName, schema)
    .then(() => {
      store.dispatch(set(`config.modules.crud.${db}.collections.${collectionName}`, collection))
    })
    .catch(error => {
      console.log("Error", error)
      notify("error", "Error", "Could not create table")
    })
    .finally(() => store.dispatch(decrement("pendingRequests")))
}

export const fetchCollections = (projectId) => {
  store.dispatch(increment("pendingRequests"))
  client.fetchCollectionsList(projectId)
    .then(tables => {
      store.dispatch(set(`tables.${projectId}`, tables))
    })
    .catch(error => {
      console.log("Error", error)
    })
    .finally(() => store.dispatch(decrement("pendingRequests")))
}

export const handleSetUpDb = (projectId) => {
  store.dispatch(increment("pendingRequests"))
  const crudConfig = store.getState().config.modules.crud
  const config = {}
  Object.entries(crudConfig).forEach(([dbType, dbConfig]) => {
    let collections = {}
    Object.entries(dbConfig.collections).forEach(([colName, colConfig]) => {
      collections[colName] = { schema: colConfig.schema }
    })
    config[dbType] = {
      enabled: dbConfig.enabled,
      collections: collections
    }
  })

  client.handleModify(projectId, config)
    .then(() => {
      fetchCollections(projectId)
      // notify("success", "Success", 'Successfully set up db')
    })
    .catch(error => {
      console.log("Error", error)
      notify("error", "Error", 'Could not set up db')
    })
    .finally(() => store.dispatch(decrement("pendingRequests")))
}

export const getEventSourceFromType = (type, defaultValue) => {
  let source = defaultValue
  if (type) {
    switch (type) {
      case "create-crud":
      case "update-crud":
      case "delete-crud":
        source = "database"
        break;
      default:
        source = "custom"
    }
  }
  return source
}