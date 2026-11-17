// ── lit: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return 7;
}

// ── lit: string
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return "s";
}

// ── lit: negative
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return -3;
}

// ── lit: null
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return null;
}

// ── lit: undefined
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return undefined;
}

// ── lit: object
// externals: const_0
'use strict';
return function(v0,v1,v2,v3){
return const_0;
}

// ── input: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0;
}

// ── input: by index
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v2;
}

// ── var: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var v4=v0;
return v4;
}

// ── var: named
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var some_name_4=v1;
return some_name_4;
}

// ── var: mutable
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
var count_4=1;
count_4+=v0;
return count_4;
}

// ── get: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v2.a;
}

// ── get: key that is no identifier
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v2["not-an-identifier"];
}

// ── get: computed key
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v2[v1];
}

// ── get: chained
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v2.a.a;
}

// ── get: on a literal number
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (5).constructor;
}

// ── get: on a literal string
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return "abc".length;
}

// ── at: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3[0];
}

// ── at: computed index
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3[v0];
}

// ── at: negative literal index
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3[-1];
}

// ── at: of a string
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v1[0];
}

// ── call: leaf
// externals: pair_0
'use strict';
return function(v0,v1,v2,v3){
return pair_0(v0,v1);
}

// ── call: no arguments
// externals: fn_0
'use strict';
return function(v0,v1,v2,v3){
return fn_0();
}

// ── call: five arguments
// externals: fn_0
'use strict';
return function(v0,v1,v2,v3){
return fn_0(v0,v1,v2,v3,v0);
}

// ── new: leaf
// externals: Box_0
'use strict';
return function(v0,v1,v2,v3){
return new Box_0(v0);
}

// ── new: then read
// externals: Box_0
'use strict';
return function(v0,v1,v2,v3){
return new Box_0(v0).v;
}

// ── obj: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return {a:v0};
}

// ── obj: empty
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return {};
}

// ── obj: keys that are no identifiers
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return {"a-b":v0,"1x":v1,"":v2};
}

// ── obj: computed key
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return {[v1]:v0};
}

// ── obj: read back
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return {a:v0}.a;
}

// ── arr: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return [v0,v1];
}

// ── arr: empty
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return [];
}

// ── arr: read back
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return [v0,v1][1];
}

// ── eq: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0===v1;
}

// ── eq: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0===v0;
}

// ── eq: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0===-1;
}

// ── eq: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return -2===v0;
}

// ── eq: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0===v1)===v0;
}

// ── eq: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0===(v1===v0);
}

// ── neq: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0!==v1;
}

// ── neq: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0!==v0;
}

// ── neq: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0!==-1;
}

// ── neq: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return -2!==v0;
}

// ── neq: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0!==v1)!==v0;
}

// ── neq: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0!==(v1!==v0);
}

// ── lt: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0<v1;
}

// ── lt: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0<v0;
}

// ── lt: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0<-1;
}

// ── lt: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return -2<v0;
}

// ── lt: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0<v1)<v0;
}

// ── lt: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0<(v1<v0);
}

// ── gt: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0>v1;
}

// ── gt: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0>v0;
}

// ── gt: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0>-1;
}

// ── gt: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return -2>v0;
}

// ── gt: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>v1)>v0;
}

// ── gt: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0>(v1>v0);
}

// ── lte: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0<=v1;
}

// ── lte: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0<=v0;
}

// ── lte: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0<=-1;
}

// ── lte: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return -2<=v0;
}

// ── lte: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0<=v1)<=v0;
}

// ── lte: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0<=(v1<=v0);
}

// ── gte: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0>=v1;
}

// ── gte: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0>=v0;
}

// ── gte: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0>=-1;
}

// ── gte: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return -2>=v0;
}

// ── gte: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>=v1)>=v0;
}

// ── gte: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0>=(v1>=v0);
}

// ── not: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return !(v0);
}

// ── not: of isNull
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return null!==v0;
}

// ── not: of isNullish
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return null!=v0;
}

// ── not: twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return !(!(v0));
}

// ── and: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0&&v1;
}

// ── and: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0&&v0;
}

// ── and: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0&&-1;
}

// ── and: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return -2&&v0;
}

// ── and: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0&&v1&&v0;
}

// ── and: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0&&v1&&v0;
}

// ── and: twelve operands, all truthy
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3&&1&&1&&1&&1&&1&&1&&1&&1&&1&&1&&1;
}

// ── and: twelve operands, last one decides
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return 1&&1&&1&&1&&1&&1&&1&&1&&1&&1&&1&&v0;
}

// ── and: twelve operands, first one decides
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0&&1&&1&&1&&1&&1&&1&&1&&1&&1&&1&&1;
}

// ── or: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0||v1);
}

// ── or: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0||v0);
}

// ── or: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0||-1);
}

// ── or: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (-2||v0);
}

// ── or: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0||v1||v0);
}

// ── or: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0||v1||v0);
}

// ── nullish: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0??v1);
}

// ── nullish: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0??v0);
}

// ── nullish: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0??-1);
}

// ── nullish: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (-2??v0);
}

// ── nullish: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0??v1)??v0);
}

// ── nullish: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0??(v1??v0));
}

// ── typeof: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return typeof v0;
}

// ── isType: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return "string"===typeof v1;
}

// ── isType: a type that does not exist
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return "no \"such\" type"===typeof v0;
}

// ── isNull: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return null===v0;
}

// ── isNullish: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v0==null;
}

// ── has: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ("a" in v2);
}

// ── has: computed key
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v1 in v2);
}

// ── has: key with quotes
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ("it's \"quoted\"" in v2);
}

// ── len: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3.length;
}

// ── len: of a string
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v1.length;
}

// ── ternary: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0?v1:v2);
}

// ── instanceof: leaf
// externals: Box_0
'use strict';
return function(v0,v1,v2,v3){
return (v2 instanceof Box_0);
}

// ── instanceof: against Array
// externals: Array_0
'use strict';
return function(v0,v1,v2,v3){
return (v3 instanceof Array_0);
}

// ── concat: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (""+v0+v1);
}

// ── concat: no parts
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return "";
}

// ── concat: one part
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (""+v0);
}

// ── concat: two numbers
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (""+1+2);
}

// ── concat: three parts
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (""+v0+"-"+v1);
}

// ── add: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0+v1);
}

// ── add: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0+v0);
}

// ── add: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0+(-1));
}

// ── add: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)+v0);
}

// ── add: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0+v1)+v0);
}

// ── add: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0+(v1+v0));
}

// ── sub: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0-v1);
}

// ── sub: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0-v0);
}

// ── sub: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0-(-1));
}

// ── sub: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)-v0);
}

// ── sub: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0-v1)-v0);
}

// ── sub: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0-(v1-v0));
}

// ── mul: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0*v1);
}

// ── mul: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0*v0);
}

// ── mul: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0*(-1));
}

// ── mul: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)*v0);
}

// ── mul: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0*v1)*v0);
}

// ── mul: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0*(v1*v0));
}

// ── div: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0/v1);
}

// ── div: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0/v0);
}

// ── div: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0/(-1));
}

// ── div: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)/v0);
}

// ── div: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0/v1)/v0);
}

// ── div: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0/(v1/v0));
}

// ── mod: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0%v1);
}

// ── mod: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0%v0);
}

// ── mod: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0%(-1));
}

// ── mod: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)%v0);
}

// ── mod: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0%v1)%v0);
}

// ── mod: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0%(v1%v0));
}

// ── bitAnd: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0&v1);
}

// ── bitAnd: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0&v0);
}

// ── bitAnd: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0&(-1));
}

// ── bitAnd: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)&v0);
}

// ── bitAnd: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0&v1)&v0);
}

// ── bitAnd: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0&(v1&v0));
}

// ── bitOr: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0|v1);
}

// ── bitOr: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0|v0);
}

// ── bitOr: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0|(-1));
}

// ── bitOr: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)|v0);
}

// ── bitOr: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0|v1)|v0);
}

// ── bitOr: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0|(v1|v0));
}

// ── bitXor: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0^v1);
}

// ── bitXor: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0^v0);
}

// ── bitXor: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0^(-1));
}

// ── bitXor: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)^v0);
}

// ── bitXor: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0^v1)^v0);
}

// ── bitXor: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0^(v1^v0));
}

// ── shl: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0<<v1);
}

// ── shl: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0<<v0);
}

// ── shl: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0<<(-1));
}

// ── shl: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)<<v0);
}

// ── shl: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0<<v1)<<v0);
}

// ── shl: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0<<(v1<<v0));
}

// ── shr: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>>v1);
}

// ── shr: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>>v0);
}

// ── shr: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>>(-1));
}

// ── shr: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)>>v0);
}

// ── shr: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0>>v1)>>v0);
}

// ── shr: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>>(v1>>v0));
}

// ── ushr: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>>>v1);
}

// ── ushr: same operand twice
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>>>v0);
}

// ── ushr: against a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>>>(-1));
}

// ── ushr: negative literal on the left
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((-2)>>>v0);
}

// ── ushr: left-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return ((v0>>>v1)>>>v0);
}

// ── ushr: right-nested chain
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (v0>>>(v1>>>v0));
}

// ── method: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v1.toString();
}

// ── method: with arguments
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3.slice(1,2);
}

// ── method: on a literal number
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (255).toString(16);
}

// ── method: on a negative literal
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return (-1.5).toFixed(2);
}

// ── method: a name that is no identifier
// externals: const_0
'use strict';
return function(v0,v1,v2,v3){
return const_0["to-text"]("!");
}

// ── map: leaf
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3.map((v4,v5)=>[v4,v5]);
}

// ── map: element only
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3.map(v4=>v4);
}

// ── map: body with statements
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3.map(function(v4,v5){var v6=(v4+v4);
if(v5===1){
    return "second";
}
return v6;
});
}

// ── map: object body
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3.map(v4=>({e:v4}));
}

// ── map: map inside map
// externals: (none)
'use strict';
return function(v0,v1,v2,v3){
return v3.map(v4=>v3.map((v6,v7)=>[v4,v6,v7]));
}

// ── map: array with a hole
// externals: const_0
'use strict';
return function(v0,v1,v2,v3){
return const_0.map(v4=>[v4]);
}

// ── subFn: leaf
// externals: (none)
'use strict';
function _fn_0(v0){return v0.a;}return function(v0,v1,v2,v3){
return _fn_0(v2);
}

// ── subFn: used twice
// externals: (none)
'use strict';
function _fn_0(v0){return "string"===typeof v0;}function _fn_1(v0){return "string"===typeof v0;}return function(v0,v1,v2,v3){
return [_fn_0(v0),_fn_1(v1)];
}

// ── subFn: body maps its input
// externals: (none)
'use strict';
function _fn_0(v0){return v0.map((v1,v2)=>[v1,v2]);}return function(v0,v1,v2,v3){
var v4=v0;
return [v4,_fn_0(v3),v4];
}

// ── subFn: inside a sub-function
// externals: (none)
'use strict';
function _fn_0(v0){return typeof v0;}function _fn_1(v0){return _fn_0(v0.a);}return function(v0,v1,v2,v3){
return _fn_1(v2);
}
