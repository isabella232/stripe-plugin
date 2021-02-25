async function setupPlugin({ config, global, cache }) {
    global.defaultHeaders = {
        headers: {
            'Authorization': `Bearer ${config.stripeApiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }

    global.useCache = config.useCache === 'Yes'

    const authResponse = await fetchWithRetry('https://api.stripe.com/v1/customers?limit=1', global.defaultHeaders)

    const jsonRes = await authResponse.json()
    if (!statusOk(authResponse)) {
        throw new Error(
            'Unable to connect to Stripe. Please make sure your API key is correct and that it has the required permissions.'
        )
    }
    if (global.useCache) {
        if (jsonRes.data.length) {
            cache.set('cursor', jsonRes.data[0].created)
        }
    }
    
    await runEveryHour({ global, cache })
}

async function runEveryHour({ global, cache }) {
    let cursorParams = ''
    if (global.useCache) {
        const cursorCache = await cache.get('cursor')
        const cursor = cursorCache || '0'
        cursorParams = `&created[gt]=${cursor}`
    }
    
    const customersResponse = await fetchWithRetry(`https://api.stripe.com/v1/customers?limit=999999999${cursorParams}`, global.defaultHeaders)
    const customers = await customersResponse.json()

    console.log('################')
    console.log('################')
    console.log('################')
    console.log('################')
    console.log(customers.data.length)
    console.log('################')
    console.log('################')
    console.log('################')
    console.log('################')
    console.log('################')
    console.log('################')


    let j = 0

    for (let customer of customers.data) {
        const hasActiveSubscription = customer.subscriptions.data.length > 0


        // Stripe ensures properties always exist
        let properties = {
            distinct_id: customer.email || customer.id,
            has_active_subscription: hasActiveSubscription,
            customer_name: customer.name,
            currency: customer.currency,
            created: customer.created
        }


        if (hasActiveSubscription) {

            for (let i = 0; i < customer.subscriptions.data.length; ++i) {
                let subscription = customer.subscriptions.data[i]

                properties[`subscription${i}`] = subscription
            }

            properties = flattenProperties({...properties})

        }


        posthog.capture('new_stripe_subscription', {
            ...properties,
            $set: properties
        })
        console.log(++j)
    }

    // SUGGESTION: Hit posthog search API with email domain and add to some user?
    // TODO: handle users who upgrade from non-paying to paying?
    // TODO: Get invoice details



}

async function fetchWithRetry(url, options = {}, method = 'GET', isRetry = false) {
    try {
        const res = await fetch(url, { method: method, ...options })
        return res
    } catch {
        if (isRetry) {
            throw new Error(`${method} request to ${url} failed.`)
        }
        const res = await fetchWithRetry(url, options, (method = method), (isRetry = true))
        return res
    }
}

function statusOk(res) {
    return String(res.status)[0] === '2'
}

const flattenProperties = (props, nestedChain = []) => {
    const sep = '__'
    let newProps = {}
    for (const [key, value] of Object.entries(props)) {
        if (Array.isArray(value)) {
            let objectFromArray = {}
            for (let i = 0; i < value.length; ++i) {
                objectFromArray[i] = value[i]
            }
            props[key] = {...objectFromArray}
            newProps = {...newProps, ...flattenProperties(props[key], [...nestedChain, key])}
        } 
        else if (
            value !== null &&
            typeof value === 'object' &&
            Object.keys(value).length > 0
        ) {
            newProps = {...newProps, ...flattenProperties(props[key], [...nestedChain, key])}
            delete props[key] 
        } 
        else {
            if (nestedChain.length > 0) {
                newProps[nestedChain.join(sep) + `${sep}${key}`] = value
            } 
        }
    }
    if (nestedChain.length > 0) {
        return {...newProps}
    }
    return {...props, ...newProps}
}

module.exports = {
    runEveryHour,
    setupPlugin
}
