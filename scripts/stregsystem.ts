import {promise_cond} from "./util/async";
import config from "../config";

const {base_api_url, default_room} = config;

// @ts-ignore - the analyzer does not know how to deal with `bundle-text` imports
import access_failure_msg from 'bundle-text:../components/stregsystem/access_failure.pug';
// @ts-ignore - see above ^
import access_no_api from 'bundle-text:../components/stregsystem/access_no_api.pug';
import {reduce_sum} from "./util/common";

export interface UserProfile {
    username: string,
    id: number,
    active: boolean,
    name: string,
    balance: number,
}

interface SaleResponse {
    status: string,
    msg: string,
    values: {
        order: {
            room: number,
            member: number, // string?
            create_on: string,
            items: string,
        },
        promille: number,
        is_ballmer_peaking: boolean
        bp_minutes: number,
        bp_seconds: number,
        caffeine: number,
        cups: number,
        product_contains_caffeine: boolean,
        is_coffee_master: boolean,
        cost: number,
        give_multibuy_hint: boolean,
        sale_hints: boolean,
    }
}

interface ActiveProductList {
    [product_id: string]: [
        string, // Product name
        number, // Price
    ]
}

/*
    API Calls
 */

/**
 * Gets the id that corresponds to a given username.
 * @param username
 */
const get_user_id = (username: string): Promise<number> =>
    fetch(`${base_api_url}/member/get_id?username=${username}`)
        .then(res => promise_cond(res.status === 200, res, "Invalid status code"))
        .then(res => res.json())
        .then(value => value['member_id']);

/**
 * Gets the user information associated with the given user id.
 * @param user_id
 */
const get_user_info = (user_id: number): Promise<any> =>
    fetch(`${base_api_url}/member?member_id=${user_id}`)
        .then(res => promise_cond(res.status === 200, res, res))
        .then(res => res.json());

/**
 * Get the current balance of the given user by id.
 * @param user_id
 */
const get_user_balance = (user_id: number): Promise<number> =>
    fetch(`${base_api_url}/member/balance?member_id=${user_id}`)
        .then(res => promise_cond(res.status === 200, res, res))
        .then(res => res.json())
        .then(value => value['balance']);

/**
 * Get a list of products that are active within a given room.
 * @param room_id
 */
const get_active_products = (room_id: number): Promise<ActiveProductList> =>
    fetch(`${base_api_url}/products/active_products?room_id=${room_id}`)
        .then(res => promise_cond(res.status === 200, res, res))
        .then(res => res.json());

/**
 * Performs a sale request.
 * @param buystring A string describing the products that are to be purchased.
 * @param room
 * @param user_id
 */
const post_sale = (buystring: string, room: number, user_id: number): Promise<SaleResponse> =>
    fetch(`${base_api_url}/sale`, {
        method: 'POST',
        cache: "no-cache",
        headers: {
            "Content-Type": 'application/json',
        },
        body: JSON.stringify({buy_string: buystring, room, member_id: user_id}),
    })
        .then(res => promise_cond(res.status === 200, res, res))
        .then(res => res.json());


/*
    Public interface
 */

export enum AccessStatus {
    StregsystemUnavailable = 0,
    StregsystemAvailable,
    ApiAvailable,
}

/**
 * Check whether the stregsystem can be reached.
 */
export const check_access = (): Promise<AccessStatus> =>
    fetch(`${base_api_url}/..`)
        .if(res => res.status === 200, AccessStatus.StregsystemAvailable)
        .then_if_async(state => fetch(`${base_api_url}/products/active_products?room_id=${default_room}`)
            .if(res => res.status === 200, AccessStatus.ApiAvailable)
            .else_use(state))
        .else_promise(AccessStatus.StregsystemUnavailable)
        .catch(err => {
            console.log("Stregsystem access check failed.");
            console.log(err);
            return AccessStatus.StregsystemUnavailable;
        });

/**
 * Fetches a user profile by username.
 * @param username
 */
export const fetch_profile = async (username: string): Promise<UserProfile> => {
    const user_id = await get_user_id(username);
    const {name, active, balance} = await get_user_info(user_id);

    return {
        username, id: user_id,
        name, active, balance,
    };
};

/*
    UI / HTML Elements
 */

/**
 * Formats a stregdollar price value as `XX.XX kr`
 * @param value
 */
const format_stregdollar = (value: number): string => `${(value / 100).toFixed(2)} kr`;

/**
 * Custom HTML element class for element `<fa-streg-product>`.
 * Represents a stregsystem product.
 */
class FaStregProduct extends HTMLElement {
    target_cart: FaStregCart;

    product_id: number;
    price: number;
    name: string;

    constructor(target: FaStregCart, product_id: number, name: string, price: number) {
        super();

        this.target_cart = target;

        this.product_id = product_id;
        this.price = price;
        this.name = name;

        // Maybe use shadow root instead?
        this.innerHTML = `${name}<span>${format_stregdollar(price)}</span>`;

        this.addEventListener('click', this.addToCart);
    }

    addToCart() {
        const cart_contents = this.target_cart.contents;
        if (cart_contents[this.product_id] == null)
            cart_contents[this.product_id] = 1;
        else
            cart_contents[this.product_id] += 1;

        this.target_cart.update();
    }

}

class FaStregCart extends HTMLElement {
    owner: FaStregsystem;
    contents: { [id: number]: number } = {};

    product_counter: HTMLSpanElement;
    total_display: HTMLSpanElement;

    constructor(owner: FaStregsystem) {
        super();

        this.owner = owner;

        this.product_counter = document.createElement('span');
        this.total_display = document.createElement('span');

        this.update();

        const product_count = document.createElement('span')
        product_count.innerText = 'Items: ';
        product_count.append(this.product_counter);

        this.append(product_count, this.total_display);

    }

    /**
     * Updates the HTML dom to reflect the current internal state.
     */
    update() {
        this.product_counter.innerText = this.compute_product_count().toString();
        this.total_display.innerText = format_stregdollar(this.compute_total());
    }

    /**
     * Compute the total value of the carts contents.
     */
    compute_total(): number {
        return Object.keys(this.contents)
            .map(id => this.owner.catalogue[id][1] * this.contents[id])
            .reduce(reduce_sum, 0);
    }

    /**
     * Compute the number of items in the cart.
     */
    compute_product_count(): number {
        return Object.keys(this.contents)
            .map(key => this.contents[key])
            .reduce(reduce_sum, 0);
    }

    /**
     * Convert the cart contents into a stregsystem multibuy string.
     */
    get_buy_string(): string {
        return Object.keys(this.contents)
            .filter(key => this.contents[key] > 0)
            .map(key => `${key}:${this.contents[key]}`)
            .join(' ');
    }
}

class FaCartStregDialog extends HTMLDialogElement {
    cart: FaStregCart;

    constructor() {
        super();


    }
}

class FaStregsystem extends HTMLElement {

    catalogue: ActiveProductList;
    cart: FaStregCart;

    constructor() {
        super();

        void (async (self) => {
            console.log("initiating stregsystem module");

            if ((await self.check_access()) === false)
                return

            self.cart = new FaStregCart(self);

            /*
                Create product list
             */

            const product_container = document.createElement('div');
            product_container.classList.add("border-outer")


            this.catalogue = await get_active_products(default_room);
            const product_elements = Object.keys(this.catalogue)
                .map(key => new FaStregProduct(self.cart, parseInt(key), ...this.catalogue[key]));

            product_container.append(...product_elements);
            self.append(product_container, self.cart);
        })(this);

    }

    async check_access(): Promise<boolean> {
        const access_state = await check_access();
        if (access_state === AccessStatus.StregsystemUnavailable) {
            console.log("unable to connect to stregsystem");
            this.classList.add('flex-center', 'center');
            this.innerHTML = access_failure_msg;
            return false;
        } else if (access_state !== AccessStatus.ApiAvailable) {
            console.log("target stregsystem instance does not have API support")
            this.classList.add('flex-center', 'center');
            this.innerHTML = access_no_api;
            return false;
        }
        return true;
    }
}

export const init = () => {
    customElements.define("fa-streg-product", FaStregProduct);
    customElements.define("fa-streg-cart", FaStregCart);
    customElements.define("fa-streg-cart-dialog", FaCartStregDialog)
    customElements.define("fa-stregsystem", FaStregsystem);
};

