// externals: Event_0, isSignedNumericString_0, Number_0, Date_0, isSignedIntegerString_0, BigInt_0, base64ToTypedArray_0, const_0, String_0
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=new Event_0();
if(("id" in v0)){
    if(null!=v0.id){
        var v4=false;
        if(v2.loosely!==false&&"string"===typeof v0.id){
            v4=isSignedNumericString_0(v0.id);
        }
        v3.id=("number"===typeof v0.id?v0.id:(v2.loosely!==false&&"boolean"===typeof v0.id?(v0.id?1:0):(v4?Number_0(v0.id):v0.id)));
    }
}
if(("at" in v0)){
    if(null!=v0.at){
        v3.at=new Date_0(v0.at);
    }
}
if(("big" in v0)){
    if(null!=v0.big){
        var v5=false;
        if("string"===typeof v0.big){
            v5=isSignedIntegerString_0(v0.big);
        }
        var v6=("bigint"===typeof v0.big?v0.big:((v5||v2.loosely!==false&&"number"===typeof v0.big)?BigInt_0(v0.big):v0.big));
        v3.big=v6;
    }
}
if(("bytes" in v0)){
    if(null!=v0.bytes){
        var v7=undefined;
        if((v0.bytes instanceof const_0)){
            v7=v0.bytes;
        }else{
            v7=base64ToTypedArray_0(v0.bytes,const_0);
        }
        v3.bytes=v7;
    }
}
if(("title" in v0)){
    if(null!=v0.title){
        var v8=v0.title;
        if(v2.loosely!==false&&("number"===typeof v0.title||"boolean"===typeof v0.title||"bigint"===typeof v0.title)){
            v8=String_0(v0.title);
        }
        v3.title=v8;
    }
}
if(("until" in v0)){
    if(null!=v0.until){
        v3.until=new Date_0(v0.until);
    }else{
        v3.until=undefined;
    }
}
return v3;
}
